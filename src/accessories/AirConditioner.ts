import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';
import { Active, FanSpeed } from '../model.js';

// HAP-NodeJS가 onSet 세 번째 인자로 넘기는 연결 정보 중 로그에 쓰는 부분(homebridge 타입에 export 안 됨)
type HAPConnection = { remoteAddress?: string; remotePort?: number; sessionID?: string };

export class AirConditioner {
  private service: Service;
  private roomName: string;
  private state = {
    active: Active.off as string,
    fanSpeed: FanSpeed.auto as string,
    swingModeVertical: Active.off as string,
    swingModeHorizontal: Active.off as string,
  };

  // 홈 앱은 풍량 슬라이더를 끄는 동안 값마다 RotationSpeed를 보내고, 매번 Active=1도 같이 보낸다(실측: 한 번 조절에
  // 풍량 4번 + 전원 4번). 그대로 다 보내면 에어컨이 그만큼 명령을 받으니, 풍량은 조작이 멈춘 뒤 마지막 값만 보내고,
  // 같은 값의 전원·스윙 명령이 짧은 시간에 반복되면 한 번만 보낸다(다른 값이거나 시간이 지나면 항상 보냄).
  // 실측: 손가락을 슬라이더에 올려 둔 동안 같은 값(33)과 Active=1이 0.5~1초 간격으로 5초 넘게 계속 들어왔다.
  // 그래서 풍량은 1초 조용할 때까지 기다리고, 직전에 보낸 것과 같은 풍량이면 10초 안에는 다시 보내지 않는다.
  // 전원은 3초만 묶는다: 끄기가 안 먹었을 때 다시 누른 끄기를 막으면 안 되기 때문이다.
  private static readonly SPEED_SETTLE_MS = 1000;
  private static readonly SPEED_REPEAT_WINDOW_MS = 10_000;
  private static readonly REPEAT_WINDOW_MS = 3000;
  private speedTimer?: ReturnType<typeof setTimeout>;
  private lastSent = new Map<string, { value: string; at: number }>();

  constructor(
    private readonly platform: HomebridgeHTTPPlugin,
    private readonly accessory: PlatformAccessory,
  ) {
    this.platform.log.info('constructor', platform.config);
    const char = this.platform.Characteristic;
    this.roomName = this.platform.config.roomName;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(char.Manufacturer, 'HyunHo Home')
      .setCharacteristic(char.Model, 'Air Conditioner')
      .setCharacteristic(char.SerialNumber, 'Air Conditioner');

    this.service = this.accessory.getService(this.platform.Service.HeaterCooler) ||
      this.accessory.addService(this.platform.Service.HeaterCooler);

    this.service.setCharacteristic(char.Name, accessory.context.config.name);

    this.service.getCharacteristic(char.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.service.getCharacteristic(char.CurrentHeaterCoolerState)
      .setProps({ validValues: [char.CurrentHeaterCoolerState.COOLING] })
      .onGet(this.handleCurrentStateGet.bind(this));

    this.service.getCharacteristic(char.TargetHeaterCoolerState)
      .setProps({ validValues: [char.TargetHeaterCoolerState.COOL] })
      .onGet(this.handleTargetStateGet.bind(this))
      .onSet(this.handleTargetStateSet.bind(this));

    this.service.getCharacteristic(char.CurrentTemperature)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 0.1,
      })
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(char.CoolingThresholdTemperature)
      .setProps({
        minValue: 18,
        maxValue: 30,
        minStep: 1,
      })
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    // 알려진 문제: 이 특성이 있으면 홈 앱이 타일 탭을 전원(Active) 대신 SwingMode 쓰기로 보내는 일이 몰아서 생긴다
    // (2026-11-16 실측, 정상 탭과 같은 허브·같은 연결에서 홈 앱이 처음부터 SwingMode=1을 보냄). 원인 조사 중.
    // 스윙을 스위치로 빼 보면 기기가 '여러 기능 묶음'이 돼서 타일 탭이 바로 켜기가 아니라 상세 화면 열기가 된다.
    this.service.getCharacteristic(char.SwingMode)
      .onGet(this.handleSwingModeVerticalGet.bind(this))
      .onSet(this.handleSwingModeVerticalSet.bind(this));

    this.service.getCharacteristic(char.RotationSpeed)
      // 홈킷 기본 범위(0~100, 1 단위)를 쓴다(예전 1~100/33 단위 대신). validValueRanges도 같이 적는다:
      // setProps는 안 적은 속성을 지우지 않아서, 예전에 캐시된 [1, 100] 제한이 그대로 남아 있었다.
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
        validValueRanges: [0, 100],
      })
      .onGet(this.handleRotationSpeedGet.bind(this))
      .onSet(this.handleRotationSpeedSet.bind(this));

    // 잠깐 붙였던 바람 스위치가 캐시에 남아 있으면 지운다(냉난방기 하나짜리 기기로 되돌림)
    for (const subtype of ['wind_vertical', 'wind_horizontal']) {
      const sw = this.accessory.getServiceById(this.platform.Service.Switch, subtype);
      if (sw) {
        this.service.removeLinkedService(sw);
        this.accessory.removeService(sw);
      }
    }
    this.service.setPrimaryService(false);
  }

  private isRepeat(key: string, value: string, windowMs = AirConditioner.REPEAT_WINDOW_MS): boolean {
    const now = Date.now();
    const prev = this.lastSent.get(key);
    if (prev && prev.value === value && now - prev.at < windowMs) {
      return true;
    }
    this.lastSent.set(key, { value, at: now });
    return false;
  }

  // 원인 조사용: 어느 컨트롤러 연결(홈 허브)에서 온 쓰기인지 남긴다
  private source(connection?: HAPConnection): string {
    return `from=${connection?.remoteAddress}:${connection?.remotePort} session=${String(connection?.sessionID ?? '-').slice(0, 8)}`;
  }

  async handleActiveGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/power/get?room_name=${this.roomName}`);
    const state = response.data as string;
    this.state.active = state;
    const active = (state === Active.on);
    this.platform.log.info('Get Active ->', active);
    return active;
  }

  async handleActiveSet(value: CharacteristicValue, _context?: unknown, connection?: HAPConnection) {
    const active = value as boolean;
    const state = (active ? Active.on : Active.off);
    this.platform.log.info('handleActiveSet', state, this.source(connection));
    if (this.isRepeat('power', state)) {
      this.platform.log.info('Skip Active -> 같은 명령 반복', state);
      return;
    }

    // 마지막으로 읽은 상태와 같아도 보낸다: 그 상태는 홈킷이 읽어 갈 때만 갱신돼서, 리모컨·자동화 등으로
    // 실제 상태가 바뀐 뒤에는 틀릴 수 있다(같은 명령을 다시 보내도 결과는 같다).
    const response = await api.get(`http://localhost:8000/aircon/power/set?room_name=${this.roomName}&state=${state}`);
    if (response.status === 200) {
      this.state.active = state;
      this.platform.log.info('Set Active ->', active, state);
    } else {
      this.platform.log.error('[ERROR] Set Active ->', response.status, response.data);
    }
  }

  async handleCurrentStateGet(): Promise<CharacteristicValue> {
    const current = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
    this.platform.log.info('Get CurrentHeaterCoolerState ->', current);
    return current;
  }

  async handleTargetStateGet(): Promise<CharacteristicValue> {
    const target = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
    this.platform.log.info('Get TargetHeaterCoolerState ->', target);
    return target;
  }

  async handleTargetStateSet(value: CharacteristicValue) {
    this.platform.log.info('handleTargetStateSet');
    const target = value as number;
    this.platform.log.info('No Set TargetHeaterCoolerState ->', target);
  }

  async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/current_temp/get?room_name=${this.roomName}`);
    const temperature = response.data as number;
    this.platform.log.info('Get CurrentTemperature ->', temperature);
    return temperature;
  }

  async handleTargetTemperatureGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/target_temp/get?room_name=${this.roomName}`);
    const temperature = response.data as number;
    this.platform.log.info('Get TargetTemperature ->', temperature);
    return temperature;
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.platform.log.info('handleTargetTemperatureSet');
    const temperature = value as number;

    const response = await api.get(`http://localhost:8000/aircon/target_temp/set?room_name=${this.roomName}&state=${temperature}`);
    if (response.status === 200) {
      this.platform.log.info('Set TargetTemperature ->', value);
    } else {
      this.platform.log.error('[ERROR] Set TargetTemperature ->', response.status, response.data);
    }
  }

  async handleRotationSpeedGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/wind_power/get?room_name=${this.roomName}`);
    const speed = response.data as string;
    this.state.fanSpeed = speed;
    this.platform.log.info('Get RotationSpeed ->', speed);
    switch (speed) {
      case FanSpeed.auto:
        return 1;
      case FanSpeed.low:
        return 34;
      case FanSpeed.mid:
        return 67;
      case FanSpeed.high:
        return 100;
      default:
        this.platform.log.error('[ERROR] Get RotationSpeed ->', speed);
        return 0;
    }
  }

  async handleRotationSpeedSet(value: CharacteristicValue, _context?: unknown, connection?: HAPConnection) {
    const speed = value as number;
    this.platform.log.info('handleRotationSpeedSet', speed, this.source(connection));
    let data: string;
    if (speed <= 1) {
      data = FanSpeed.auto;
    } else if (1 < speed && speed <= 34) {
      data = FanSpeed.low;
    } else if (34 < speed && speed <= 67) {
      data = FanSpeed.mid;
    } else if (67 < speed && speed <= 100) {
      data = FanSpeed.high;
    } else {
      this.platform.log.error('[ERROR] Set RotationSpeed ->', speed);
      return;
    }

    // 조작이 멈출 때까지 기다렸다가 마지막 값만 보낸다. 마지막으로 읽은 상태와 같아도 보낸다: 그 상태는 홈킷이
    // 읽어 갈 때만 갱신돼서, 리모컨·자동화 등으로 실제 상태가 바뀐 뒤에는 틀릴 수 있다.
    this.state.fanSpeed = data;
    clearTimeout(this.speedTimer);
    this.speedTimer = setTimeout(() => {
      if (this.isRepeat('wind_power', data, AirConditioner.SPEED_REPEAT_WINDOW_MS)) {
        this.platform.log.info('Skip RotationSpeed -> 같은 풍량 반복', data);
        return;
      }
      api.get(`http://localhost:8000/aircon/wind_power/set?room_name=${this.roomName}&state=${data}`)
        .then(response => this.platform.log.info('Set RotationSpeed ->', speed, data, response.status))
        .catch(err => this.platform.log.error('[ERROR] Set RotationSpeed ->', speed, data, String(err)));
    }, AirConditioner.SPEED_SETTLE_MS);
  }

  async handleSwingModeVerticalGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/wind_vertical/get?room_name=${this.roomName}`);
    const state = response.data as string;
    this.state.swingModeVertical = state;
    const active = (state === 'on');
    this.platform.log.info('Get SwingMode Vertical ->', active);
    return active;
  }

  async handleSwingModeVerticalSet(value: CharacteristicValue, _context?: unknown, connection?: HAPConnection) {
    const active = value as boolean;
    const state = (active ? 'on' : 'off');
    this.platform.log.info('handleSwingModeVerticalSet', state, this.source(connection));
    if (this.isRepeat('swing_vertical', state)) {
      this.platform.log.info('Skip SwingMode Vertical -> 같은 명령 반복', state);
      return;
    }

    // 마지막으로 읽은 상태와 같아도 보낸다: 그 상태는 홈킷이 읽어 갈 때만 갱신돼서, 리모컨·자동화 등으로
    // 실제 상태가 바뀐 뒤에는 틀릴 수 있다(같은 명령을 다시 보내도 결과는 같다).
    const response = await api.get(`http://localhost:8000/aircon/wind_vertical/set?room_name=${this.roomName}&state=${state}`);
    if (response.status === 200) {
      this.state.swingModeVertical = state;
      this.platform.log.info('Set SwingMode Vertical ->', active, state);
    } else {
      this.platform.log.error('[ERROR] Set SwingMode Vertical ->', response.status, response.data);
    }
  }

  async handleSwingModeHorizontalGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/wind_horizontal/get?room_name=${this.roomName}`);
    const state = response.data as string;
    this.state.swingModeHorizontal = state;
    const active = (state === 'on');
    this.platform.log.info('Get SwingMode Horizontal ->', active);
    return active;
  }

  async handleSwingModeHorizontalSet(value: CharacteristicValue, _context?: unknown, connection?: HAPConnection) {
    const active = value as boolean;
    const state = (active ? 'on' : 'off');
    this.platform.log.info('handleSwingModeHorizontalSet', state, this.source(connection));
    if (this.isRepeat('swing_horizontal', state)) {
      this.platform.log.info('Skip SwingMode Horizontal -> 같은 명령 반복', state);
      return;
    }

    // 마지막으로 읽은 상태와 같아도 보낸다: 그 상태는 홈킷이 읽어 갈 때만 갱신돼서, 리모컨·자동화 등으로
    // 실제 상태가 바뀐 뒤에는 틀릴 수 있다(같은 명령을 다시 보내도 결과는 같다).
    const response = await api.get(`http://localhost:8000/aircon/wind_horizontal/set?room_name=${this.roomName}&state=${state}`);
    if (response.status === 200) {
      this.state.swingModeHorizontal = state;
      this.platform.log.info('Set SwingMode Horizontal ->', active, state);
    } else {
      this.platform.log.error('[ERROR] Set SwingMode Horizontal ->', response.status, response.data);
    }
  }
}

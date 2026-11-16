import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';
import { Active, FanSpeed } from '../model.js';

export class AirConditioner {
  private service: Service;
  private roomName: string;
  private state = {
    active: Active.off as string,
    fanSpeed: FanSpeed.auto as string,
    swingModeVertical: Active.off as string,
    swingModeHorizontal: Active.off as string,
  };

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

    // // 좌우 풍향 모드
    // const switchWindHorizontalService = this.accessory.getService('좌우 풍향')
    //   || this.accessory.addService(this.platform.Service.Switch, '좌우 풍향', '좌우 풍향');
    // switchWindHorizontalService.getCharacteristic(char.On)
    //   .onGet(this.handleSwingModeHorizontalGet.bind(this))
    //   .onSet(this.handleSwingModeHorizontalSet.bind(this));
  }

  async handleActiveGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/power/get?room_name=${this.roomName}`);
    const state = response.data as string;
    this.state.active = state;
    const active = (state === Active.on);
    this.platform.log.info('Get Active ->', active);
    return active;
  }

  async handleActiveSet(value: CharacteristicValue) {
    this.platform.log.info('handleActiveSet');
    const active = value as boolean;
    const state = (active ? Active.on : Active.off);

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

  async handleRotationSpeedSet(value: CharacteristicValue) {
    this.platform.log.info('handleRotationSpeedSet');
    const speed = value as number;
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

    // 마지막으로 읽은 상태와 같아도 보낸다: 그 상태는 홈킷이 읽어 갈 때만 갱신돼서, 리모컨·자동화 등으로
    // 실제 상태가 바뀐 뒤에는 틀릴 수 있다(같은 명령을 다시 보내도 결과는 같다).
    const response = await api.get(`http://localhost:8000/aircon/wind_power/set?room_name=${this.roomName}&state=${data}`);
    if (response.status === 200) {
      this.state.fanSpeed = data;
      this.platform.log.info('Set RotationSpeed ->', speed, data);
    } else {
      this.platform.log.error('[ERROR] Set SwingMode ->', response.status, response.data);
    }
  }

  async handleSwingModeVerticalGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/wind_vertical/get?room_name=${this.roomName}`);
    const state = response.data as string;
    this.state.swingModeVertical = state;
    const active = (state === 'on');
    this.platform.log.info('Get SwingMode Vertical ->', active);
    return active;
  }

  async handleSwingModeVerticalSet(value: CharacteristicValue) {
    this.platform.log.info('handleSwingModeVerticalSet');
    const active = value as boolean;
    const state = (active ? 'on' : 'off');

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

  async handleSwingModeHorizontalSet(value: CharacteristicValue) {
    this.platform.log.info('handleSwingModeHorizontalSet');
    const active = value as boolean;
    const state = (active ? 'on' : 'off');

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

import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';
import { Active } from '../model.js';

export class Heater {
  private service: Service;
  private roomName: string;
  private outModeName: string = 'out';
  private state = {
    active: Active.off as string,
    outMode: Active.off as string,
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
      .setCharacteristic(char.Model, 'Heater')
      .setCharacteristic(char.SerialNumber, 'Heater');

    this.service = this.accessory.getService(this.platform.Service.HeaterCooler) ||
      this.accessory.addService(this.platform.Service.HeaterCooler);

    this.service.setCharacteristic(char.Name, accessory.context.config.name);

    this.service.getCharacteristic(char.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.service.getCharacteristic(char.CurrentHeaterCoolerState)
      .setProps({ validValues: [char.CurrentHeaterCoolerState.HEATING] })
      .onGet(this.handleCurrentStateGet.bind(this));

    this.service.getCharacteristic(char.TargetHeaterCoolerState)
      .setProps({ validValues: [char.TargetHeaterCoolerState.HEAT] })
      .onGet(this.handleTargetStateGet.bind(this))
      .onSet(this.handleTargetStateSet.bind(this));

    this.service.getCharacteristic(char.CurrentTemperature)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
      })
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(char.HeatingThresholdTemperature)
      .setProps({
        minValue: 5,
        maxValue: 40,
        minStep: 1,
      })
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(char.SwingMode)
      .onGet(this.handleOutModeGet.bind(this))
      .onSet(this.handleOutModeSet.bind(this));
  }

  async handleActiveGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/heat/power/get?room_name=${this.roomName}`);
    const state = response.data as string;
    this.state.active = state;
    const active = (state !== Active.off);
    this.platform.log.info('Get Active ->', active);
    return active;
  }

  async handleActiveSet(value: CharacteristicValue) {
    this.platform.log.info('handleActiveSet');
    const active = value as boolean;
    const state = (active ? Active.on : Active.off);

    // 마지막으로 읽은 상태와 같아도 보낸다: 그 상태는 홈킷이 읽어 갈 때만 갱신돼서, 월패드·리모컨·자동화 등으로
    // 실제 상태가 바뀐 뒤에는 틀릴 수 있다(같은 명령을 다시 보내도 결과는 같다).
    const response = await api.get(`http://localhost:8000/heat/power/set?room_name=${this.roomName}&state=${state}`);
    if (response.status === 200) {
      this.state.active = state;
      this.platform.log.info('Set Active ->', active, state);
    } else {
      this.platform.log.error('[ERROR] Set Active ->', response.status, response.data);
    }
  }

  async handleCurrentStateGet(): Promise<CharacteristicValue> {
    const current = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
    this.platform.log.info('Get CurrentHeaterCoolerState ->', current);
    return current;
  }

  async handleTargetStateGet(): Promise<CharacteristicValue> {
    const target = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
    this.platform.log.info('Get TargetHeaterCoolerState ->', target);
    return target;
  }

  async handleTargetStateSet(value: CharacteristicValue) {
    this.platform.log.info('handleTargetStateSet');
    const target = value as number;
    this.platform.log.info('No Set TargetHeaterCoolerState ->', target);
  }

  async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/heat/current_temp/get?room_name=${this.roomName}`);
    const temperature = response.data as number;
    this.platform.log.info('Get CurrentTemperature ->', temperature);
    return temperature;
  }

  async handleTargetTemperatureGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/heat/target_temp/get?room_name=${this.roomName}`);
    const temperature = response.data as number;
    this.platform.log.info('Get TargetTemperature ->', temperature);
    return temperature;
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.platform.log.info('handleTargetTemperatureSet');
    const temperature = value as number;

    const response = await api.get(`http://localhost:8000/heat/target_temp/set?room_name=${this.roomName}&state=${temperature}`);
    if (response.status === 200) {
      this.platform.log.info('Set TargetTemperature ->', value);
    } else {
      this.platform.log.error('[ERROR] Set TargetTemperature ->', response.status, response.data);
    }
  }

  async handleOutModeGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/heat/power/get?room_name=${this.roomName}`);
    const state = response.data as string;
    this.state.outMode = state;
    const active = (state === this.outModeName);
    this.platform.log.info('Get OutMode ->', active);
    return active;
  }

  async handleOutModeSet(value: CharacteristicValue) {
    this.platform.log.info('handleOutModeSet');
    const active = value as boolean;
    const state = (active ? this.outModeName : Active.off);

    // 외출 모드 끄기는 '난방 끄기'와 같은 명령이라, 지금 실제로 외출 모드일 때만 보낸다
    // (장면·자동화가 '난방 켜기 + 외출 모드 끔'을 함께 쓰면 방금 켠 난방을 끄게 된다).
    // 외출 모드 켜기는 상태와 무관하게 보낸다.
    if (!active) {
      const current = await api.get(`http://localhost:8000/heat/power/get?room_name=${this.roomName}`);
      this.state.outMode = current.data as string;
      if (this.state.outMode !== this.outModeName) {
        return;
      }
    }
    const response = await api.get(`http://localhost:8000/heat/power/set?room_name=${this.roomName}&state=${state}`);
    if (response.status === 200) {
      this.state.outMode = state;
      this.platform.log.info('Set OutMode ->', active, state);
    } else {
      this.platform.log.error('[ERROR] Set OutMode ->', response.status, response.data);
    }
  }
}

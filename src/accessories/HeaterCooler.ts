import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';

enum Active {
  on = 'on',
  off = 'off',
}

enum FanSpeed {
  low = 'low',
  mid = 'mid',
  high = 'high',
  auto = 'auto',
}

export class HeaterCooler {
  private service: Service;
  private state = {
    active: Active.off as string,
    fanSpeed: FanSpeed.auto as string,
  };

  constructor(
    private readonly platform: HomebridgeHTTPPlugin,
    private readonly accessory: PlatformAccessory,
  ) {
    this.platform.log.info('constructor', platform.config);
    const char = this.platform.Characteristic;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(char.Manufacturer, 'Thermostat-Manufacturer')
      .setCharacteristic(char.Model, 'Thermostat-Model')
      .setCharacteristic(char.SerialNumber, 'Thermostat-Serial');

    this.service = this.accessory.getService(this.platform.Service.HeaterCooler) ||
      this.accessory.addService(this.platform.Service.HeaterCooler);

    this.service.setCharacteristic(char.Name, accessory.context.config.name);

    this.service.getCharacteristic(char.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.service.getCharacteristic(char.CurrentHeaterCoolerState)
      .setProps({
        validValues: [
          char.CurrentHeaterCoolerState.COOLING,
        ],
      })
      .onGet(this.handleCurrentStateGet.bind(this));

    this.service.getCharacteristic(char.TargetHeaterCoolerState)
      .setProps({
        validValues: [
          char.TargetHeaterCoolerState.COOL,
        ],
      })
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
      .onGet(this.handleSwingModeGet.bind(this))
      .onSet(this.handleSwingModeSet.bind(this));

    this.service.getCharacteristic(char.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
        validValueRanges: [0, 100],
      })
      .onGet(this.handleRotationSpeedGet.bind(this))
      .onSet(this.handleRotationSpeedSet.bind(this));
  }

  async handleActiveGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/power/get?room_name=${this.platform.config.room_name}`);
    const data = response.data as string;
    const active = (data === Active.on);
    this.state.active = data;
    this.platform.log.info('Get Active ->', active);
    return active;
  }

  async handleActiveSet(value: CharacteristicValue) {
    this.platform.log.info('handleActiveSet');
    const active = value as boolean;
    const data = (active ? Active.on : Active.off);

    if (this.state.active !== data) {
      const response = await api.get(`http://localhost:8000/aircon/power/set?room_name=${this.platform.config.room_name}&state=${data}`);
      if (response.status === 200) {
        this.state.active = data;
        this.platform.log.info('Set Active ->', active, data);
      } else {
        this.platform.log.error('[ERROR] Set Active ->', response.status, response.data);
      }
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
    const response = await api.get(`http://localhost:8000/aircon/current_temp/get?room_name=${this.platform.config.room_name}`);
    const temperature = response.data as number;
    this.platform.log.info('Get CurrentTemperature ->', temperature);
    return temperature;
  }

  async handleTargetTemperatureGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/target_temp/get?room_name=${this.platform.config.room_name}`);
    const data = response.data;
    const temperature = data.temperature as number;
    this.platform.log.info('Get TargetTemperature ->', temperature);
    return temperature;
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.platform.log.info('handleTargetTemperatureSet');
    const temperature = value as number;

    const response = await api.get(`http://localhost:8000/aircon/target_temp/set?room_name=${this.platform.config.room_name}&temp=${temperature}`);
    if (response.status === 200) {
      this.platform.log.info('Set TargetTemperature ->', value);
    } else {
      this.platform.log.error('[ERROR] Set TargetTemperature ->', response.status, response.data);
    }
  }

  async handleSwingModeGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/wind_updown/get?room_name=${this.platform.config.room_name}`);
    const data = response.data as string;
    const active = (data === 'on');
    this.platform.log.info('Get SwingMode ->', active);
    return active;
  }

  async handleSwingModeSet(value: CharacteristicValue) {
    this.platform.log.info('handleSwingModeSet');
    const active = value as boolean;
    const data = (active ? 'on' : 'off');

    const response = await api.get(`http://localhost:8000/aircon/wind_updown/set?room_name=${this.platform.config.room_name}&wind_updown=${data}`);
    if (response.status === 200) {
      this.platform.log.info('Set SwingMode ->', active, data);
    } else {
      this.platform.log.error('[ERROR] Set SwingMode ->', response.status, response.data);
    }
  }

  async handleRotationSpeedGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/aircon/wind_power/get?room_name=${this.platform.config.room_name}`);
    const speed = response.data as string;
    this.state.fanSpeed = speed;
    this.platform.log.info('Get RotationSpeed ->', speed);
    switch (speed) {
      case FanSpeed.auto:
        return 0;
      case FanSpeed.low:
        return 25;
      case FanSpeed.mid:
        return 50;
      case FanSpeed.high:
        return 75;
      default:
        this.platform.log.error('[ERROR] Get RotationSpeed ->', speed);
        return 0;
    }
  }

  async handleRotationSpeedSet(value: CharacteristicValue) {
    this.platform.log.info('handleRotationSpeedSet');
    const speed = value as number;
    let data: string;
    switch (Math.floor(speed / 25)) {
      case 0:
        data = FanSpeed.auto;
        break;
      case 1:
        data = FanSpeed.low;
        break;
      case 2:
        data = FanSpeed.mid;
        break;
      case 3:
      case 4:
        data = FanSpeed.high;
        break;
      default:
        this.platform.log.error('[ERROR] Set RotationSpeed ->', speed);
        return;
    }

    if (this.state.fanSpeed !== data) {
      const response = await api.get(`http://localhost:8000/aircon/wind_power/set?room_name=${this.platform.config.room_name}&wind_power=${data}`);
      if (response.status === 200) {
        this.state.fanSpeed = data;
        this.platform.log.info('Set SwingMode ->', speed, data);
      } else {
        this.platform.log.error('[ERROR] Set SwingMode ->', response.status, response.data);
      }
    }
  }
}

import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';
import { Active, FanSpeed } from '../model.js';


export class Fan {
  private service: Service;
  private state = {
    power: FanSpeed.off as string,
    bipass: Active.off as string,
  };

  constructor(
    private readonly platform: HomebridgeHTTPPlugin,
    private readonly accessory: PlatformAccessory,
  ) {
    this.platform.log.info('constructor', platform.config);
    const char = this.platform.Characteristic;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(char.Manufacturer, 'HyunHo Home')
      .setCharacteristic(char.Model, 'Fan')
      .setCharacteristic(char.SerialNumber, 'Fan');

    this.service = this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);

    this.service.setCharacteristic(char.Name, accessory.context.config.name);

    this.service.getCharacteristic(char.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.service.getCharacteristic(char.SwingMode)
      .onGet(this.handleSwingModeGet.bind(this))
      .onSet(this.handleSwingModeSet.bind(this));

    this.service.getCharacteristic(char.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 10,
        // validValueRanges: [0, 100],
      })
      .onGet(this.handleRotationSpeedGet.bind(this))
      .onSet(this.handleRotationSpeedSet.bind(this));
  }

  async handleActiveGet(): Promise<CharacteristicValue> {
    const response = await api.get('http://localhost:8000/fan/power/get');
    const data = response.data as string;
    const active = (data !== FanSpeed.off);
    this.state.power = data;
    this.platform.log.info('Get Active ->', active);
    return active;
  }

  async handleActiveSet(value: CharacteristicValue) {
    this.platform.log.info('handleActiveSet');
    const active = value as boolean;
    const data = active ? FanSpeed.high : FanSpeed.off;
    if (this.state.power !== data) {
      const response = await api.get(`http://localhost:8000/fan/power/set?power=${data}`);
      if (response.status === 200) {
        this.state.power = data;
        this.platform.log.info('Set Active ->', active, data);
      } else {
        this.platform.log.error('[ERROR] Set Active ->', response.status, response.data);
      }
    }
  }

  async handleRotationSpeedGet(): Promise<CharacteristicValue> {
    const response = await api.get('http://localhost:8000/fan/power/get');
    const speed = response.data as string;
    this.state.power = speed;
    this.platform.log.info('Get RotationSpeed ->', speed);
    switch (speed) {
      case FanSpeed.off:
        return 0;
      case FanSpeed.low:
        return 30;
      case FanSpeed.mid:
        return 60;
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
    if (speed === 0) {
      // 0으로 설정하면 active off 호출됨
      return;
    } else if (0 < speed && speed <= 30) {
      data = FanSpeed.low;
    } else if (30 < speed && speed <= 60) {
      data = FanSpeed.mid;
    } else if (60 < speed && speed <= 100) {
      data = FanSpeed.high;
    } else {
      this.platform.log.error('[ERROR] Set RotationSpeed ->', speed);
      return;
    }

    if (this.state.power !== data) {
      const response = await api.get(
        `http://localhost:8000/fan/power/set?power=${data}`,
      );
      if (response.status === 200) {
        this.state.power = data;
        this.platform.log.info('Set SwingMode ->', speed, data);
      } else {
        this.platform.log.error('[ERROR] Set SwingMode ->', response.status, response.data);
      }
    }
  }

  async handleSwingModeGet(): Promise<CharacteristicValue> {
    const response = await api.get('http://localhost:8000/fan/bipass/get');
    const data = response.data as string;
    const active = (data === 'on');
    this.platform.log.info('Get SwingMode ->', active);
    return active;
  }

  async handleSwingModeSet(value: CharacteristicValue) {
    this.platform.log.info('handleSwingModeSet');
    const active = value as boolean;
    const data = (active ? 'on' : 'off');

    const response = await api.get(
      `http://localhost:8000/fan/bipass/set?bipass=${data}`,
    );
    if (response.status === 200) {
      this.platform.log.info('Set SwingMode ->', active, data);
    } else {
      this.platform.log.error('[ERROR] Set SwingMode ->', response.status, response.data);
    }
  }
}

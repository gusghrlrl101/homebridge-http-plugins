import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';
import { Active } from '../model.js';


export class Cook {
  private service: Service;
  private state = {
    power: Active.off as string,
  };

  constructor(
    private readonly platform: HomebridgeHTTPPlugin,
    private readonly accessory: PlatformAccessory,
  ) {
    this.platform.log.info('constructor', platform.config);
    const char = this.platform.Characteristic;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(char.Manufacturer, 'HyunHo Home')
      .setCharacteristic(char.Model, 'Cook')
      .setCharacteristic(char.SerialNumber, 'Cook');

    this.service = this.accessory.getService(this.platform.Service.Outlet) ||
      this.accessory.addService(this.platform.Service.Outlet);

    this.service.setCharacteristic(char.Name, accessory.context.config.name);

    this.service.getCharacteristic(char.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));
  }

  async handleOnGet(): Promise<CharacteristicValue> {
    const response = await api.get('http://localhost:8000/cook/power/get');
    const state = response.data as string;
    this.state.power = state;
    const active = (state === Active.on);
    this.platform.log.info('Get On ->', active);
    return active;
  }

  async handleOnSet(value: CharacteristicValue) {
    this.platform.log.info('handleOnSet');
    const active = value as boolean;
    const state = Active.off;
    if (this.state.power !== state) {
      const response = await api.get('http://localhost:8000/cook/power/lock');
      if (response.status === 200) {
        this.state.power = state;
        this.platform.log.info('Set On ->', active, state);
      } else {
        this.platform.log.error('[ERROR] Set On ->', response.status, response.data);
      }
    }
  }
}

import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';
import { Active } from '../model.js';


export class InfraRed {
  private service: Service;
  private deviceName: string;
  private state = {
    active: Active.off as string,
    mode: 1,
  };

  constructor(
    private readonly platform: HomebridgeHTTPPlugin,
    private readonly accessory: PlatformAccessory,
  ) {
    this.platform.log.info('constructor', platform.config);

    const char = this.platform.Characteristic;
    this.deviceName = accessory.context.config.name;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(char.Manufacturer, 'HyunHo Home')
      .setCharacteristic(char.Model, 'InfraRed')
      .setCharacteristic(char.SerialNumber, 'InfraRed');

    this.service = this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    this.service.setCharacteristic(char.Name, accessory.context.config.name);

    this.service.getCharacteristic(char.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));
  }

  async handleOnGet(): Promise<CharacteristicValue> {
    return (this.state.active === Active.on);
  }

  async handleOnSet(value: CharacteristicValue) {
    this.platform.log.info('handleOnSet');
    const active = value as boolean;
    const state = (active ? 0 : 1);
    const response = await api.get(`http://localhost:8000/aqara/click?device_name=${this.deviceName}&key_num=${state}`);
    if (response.status === 200) {
      this.state.active = (active ? Active.on : Active.off);
      this.platform.log.info('Set On ->', active, state);
    } else {
      this.platform.log.error('[ERROR] Set On ->', response.status, response.data);
    }
  }
}

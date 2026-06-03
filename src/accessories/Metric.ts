import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';


export class Metric {
  private service: Service;
  private metricName: string;
  private state: number = 0.0001;

  constructor(
    private readonly platform: HomebridgeHTTPPlugin,
    private readonly accessory: PlatformAccessory,
  ) {
    this.platform.log.info('constructor', platform.config);
    const char = this.platform.Characteristic;

    this.metricName = this.platform.config.metricName;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(char.Manufacturer, 'HyunHo Home')
      .setCharacteristic(char.Model, 'Metric')
      .setCharacteristic(char.SerialNumber, 'Metric');

    this.service = this.accessory.getService(this.platform.Service.LightSensor) ||
      this.accessory.addService(this.platform.Service.LightSensor);
    this.service.setCharacteristic(char.Name, accessory.context.config.name);
    this.service.getCharacteristic(char.CurrentAmbientLightLevel)
      .onGet(() => this.handleOnGet());
  }

  async handleOnGet(): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/metric/get?metric_name=${this.metricName}`);
    const state = response.data as number;
    this.state = Math.max(0.0001, Math.min(100000, state));
    this.platform.log.info(`(${this.metricName}) Get On ->`, this.state);
    return this.state;
  }
}

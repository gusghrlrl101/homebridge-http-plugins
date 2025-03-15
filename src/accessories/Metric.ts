import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';


export class Metric {
  private services: Service[];
  private length: number;
  private states: number[];
  private metrics = [
    'electro',
    'unknown',
    'water',
    'hot_water',
    'heat',
  ];

  constructor(
    private readonly platform: HomebridgeHTTPPlugin,
    private readonly accessory: PlatformAccessory,
  ) {
    this.platform.log.info('constructor', platform.config);
    const char = this.platform.Characteristic;
    this.length = this.metrics.length;
    this.services = new Array(this.length);
    this.states = new Array(this.length).fill(0.0001);

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(char.Manufacturer, 'HyunHo Home')
      .setCharacteristic(char.Model, 'Metric')
      .setCharacteristic(char.SerialNumber, 'Metric');

    this.metrics.forEach((metric, i) => {
      this.services[i] = this.accessory.getService(metric) ||
        this.accessory.addService(this.platform.Service.LightSensor, metric, metric);
      this.services[i].setCharacteristic(char.Name, `${accessory.context.config.name} ${i}`);
      this.services[i].getCharacteristic(char.CurrentAmbientLightLevel)
        .onGet(() => this.handleOnGet(i));
    });
  }

  async handleOnGet(idx: number): Promise<CharacteristicValue> {
    const metric = this.metrics[idx];
    const response = await api.get(`http://localhost:8000/metric/get?metric_name=${metric}`);
    const state = response.data as number;
    this.states[idx] = Math.max(0.0001, Math.min(100000, state));
    this.platform.log.info(`(${metric}) Get On ->`, this.states[idx]);
    return this.states[idx];
  }
}

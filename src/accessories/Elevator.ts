import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';


export class Elevator {
  private elevatorCallButton: Service;
  private elevatorArrivedSensor: Service;

  constructor(
    private readonly platform: HomebridgeHTTPPlugin,
    private readonly accessory: PlatformAccessory,
  ) {
    this.platform.log.info('constructor', platform.config);
    const char = this.platform.Characteristic;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(char.Manufacturer, 'HyunHo Home')
      .setCharacteristic(char.Model, 'Elevator')
      .setCharacteristic(char.SerialNumber, 'Elevator');

    // 1. 엘리베이터 호출 버튼
    this.elevatorCallButton = this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);
    this.elevatorCallButton.setCharacteristic(char.Name, accessory.context.config.name);
    this.elevatorCallButton.getCharacteristic(char.On)
      .onGet(this.handleCallOnGet.bind(this))
      .onSet(this.handleCallOnSet.bind(this));

    // 2. 엘리베이터 도착 센서
    this.elevatorArrivedSensor = this.accessory.getService(this.platform.Service.OccupancySensor) ||
      this.accessory.addService(this.platform.Service.OccupancySensor);
    this.elevatorArrivedSensor.getCharacteristic(char.OccupancyDetected)
      .onGet(this.handleArriveOnGet.bind(this));
  }

  async handleCallOnGet(): Promise<CharacteristicValue> {
    this.platform.log.info('handleCallOnGet');
    return false;
  }

  async handleCallOnSet(value: CharacteristicValue) {
    this.platform.log.info('handleCallOnSet', value);
    const response = await api.get('http://localhost:8000/elevator/call');
    if (response.status === 200) {
      this.platform.log.info('Elevator Call');
    } else {
      this.platform.log.error('[ERROR] Set On ->', response.status, response.data);
    }
  }

  async handleArriveOnGet(): Promise<CharacteristicValue> {
    this.platform.log.info('handleArriveOnGet');
    const response = await api.get('http://localhost:8000/elevator/arrived');
    if (response.status === 200) {
      const arrived = response.data as boolean;
      this.platform.log.info('Elevator Call -> ', arrived);
      return arrived;
    } else {
      this.platform.log.error('[ERROR] Set On ->', response.status, response.data);
      return false;
    }
  }
}

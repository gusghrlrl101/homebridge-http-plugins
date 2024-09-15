import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';
import { Active, Room } from '../model.js';


export class Light {
  private services: Service[];
  private roomName: string;
  private length: number;
  private states: string[];
  private lengths = {
    [Room.master]: 2,
    [Room.living]: 3,
    [Room.kitchen]: 2,
    [Room.guest]: 4,
  };

  constructor(
    private readonly platform: HomebridgeHTTPPlugin,
    private readonly accessory: PlatformAccessory,
  ) {
    this.platform.log.info('constructor', platform.config);
    const char = this.platform.Characteristic;
    this.roomName = this.platform.config.roomName;
    this.length = this.lengths[this.roomName as Room];
    this.services = new Array(this.length);
    this.states = new Array(this.length).fill(Active.off);

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(char.Manufacturer, 'HyunHo Home')
      .setCharacteristic(char.Model, 'Light')
      .setCharacteristic(char.SerialNumber, 'Light');

    for (let i = 0; i < this.length; i++) {
      const serviceName = `Light ${this.roomName} ${i}`;
      this.services[i] = this.accessory.getService(serviceName) ||
        this.accessory.addService(this.platform.Service.Lightbulb, serviceName, serviceName);

      this.services[i].setCharacteristic(char.Name, `${accessory.context.config.name} ${i}`);
      this.services[i].getCharacteristic(char.On)
        .onGet(this.handleOnGet.bind(this, i))
        .onSet(this.handleOnSet.bind(this, i));
    }
  }

  async handleOnGet(device_num: number): Promise<CharacteristicValue> {
    const response = await api.get(`http://localhost:8000/light/power/get?room_name=${this.roomName}&device_num=${device_num}`);
    const state = response.data as string;
    this.states[device_num] = state;
    const active = (state === Active.on);
    this.platform.log.info(`(${device_num}) Get On ->`, active);
    return active;
  }

  async handleOnSet(device_num: number, value: CharacteristicValue) {
    this.platform.log.info('handleOnSet');
    const active = value as boolean;
    const state = (active ? Active.on : Active.off);
    if (this.states[device_num] !== state) {
      const response = await api.get(
        `http://localhost:8000/light/power/set?room_name=${this.roomName}&device_num=${device_num}&state=${state}`,
      );
      if (response.status === 200) {
        this.states[device_num] = state;
        this.platform.log.info(`(${device_num}) Set On ->`, active, state);
      } else {
        this.platform.log.error(`[ERROR] (${device_num}) Set On ->`, response.status, response.data);
      }
    }
  }
}

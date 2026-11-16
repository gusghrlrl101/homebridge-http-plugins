import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeHTTPPlugin } from '../platform.js';
import { api } from '../utils.js';
import { Active, Room } from '../model.js';
import { StateStream } from '../stream.js';


export class Light {
  private services: Service[];
  private roomName: string;
  private length: number;
  private states: string[];
  private stream: StateStream | null = null;
  private wait = false;
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

    // (실험) 상태 스트림: 설정에 stream이 켜져 있으면 값을 조회하지 않고 스트림에서 읽고, 바뀌면 홈킷에 바로 밀어 준다.
    this.wait = this.platform.config.wait === true;
    if (this.platform.config.stream === true) {
      this.stream = StateStream.get(this.platform.log, 'http://localhost:8000/events');
      for (let i = 0; i < this.length; i++) {
        this.stream.on(`light_${this.roomName}_${i}`, (state: string) => {
          this.states[i] = state;
          this.services[i].updateCharacteristic(char.On, state === Active.on);
          this.platform.log.info(`(${i}) Push On ->`, state === Active.on, `t=${Date.now() / 1000}`);
        });
      }
    }
  }

  async handleOnGet(device_num: number): Promise<CharacteristicValue> {
    const cached = this.stream?.fresh() ? this.stream.value(`light_${this.roomName}_${device_num}`) : undefined;
    if (cached !== undefined) {
      return cached === Active.on; // 스트림이 살아 있으면 조회 호출 없이 답한다
    }
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
    // 마지막으로 읽은 상태와 같아도 보낸다: 그 상태는 홈킷이 읽어 갈 때만 갱신돼서, 월패드·리모컨·자동화 등으로
    // 실제 상태가 바뀐 뒤에는 틀릴 수 있다(같은 명령을 다시 보내도 결과는 같다).
    const url = `http://localhost:8000/light/power/set?room_name=${this.roomName}&device_num=${device_num}&state=${state}`;
    if (this.wait) {
      // (실험) 기기가 받았다고 확인할 때까지 기다린다. 확인이 안 되면(504) 홈 앱에 "응답 없음"으로 알린다.
      const result = await api.get(`${url}&wait=true`, { timeout: 8000, validateStatus: () => true });
      if (result.status !== 200) {
        this.platform.log.error(`[ERROR] (${device_num}) Set On ->`, result.status, `t=${Date.now() / 1000}`);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
      this.states[device_num] = state;
      this.platform.log.info(`(${device_num}) Set On (확인됨) ->`, active, state);
      return;
    }
    const response = await api.get(url);
    if (response.status === 200) {
      this.states[device_num] = state;
      this.platform.log.info(`(${device_num}) Set On ->`, active, state);
    } else {
      this.platform.log.error(`[ERROR] (${device_num}) Set On ->`, response.status, response.data);
    }
  }
}

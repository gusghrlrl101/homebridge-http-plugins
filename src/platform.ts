import { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { AirConditioner } from './accessories/AirConditioner.js';
import { Fan } from './accessories/Fan.js';
import { Light } from './accessories/Light.js';
import { Cook } from './accessories/Cook.js';
import { LightAll } from './accessories/LightAll.js';
import { Heater } from './accessories/Heater.js';
import { Elevator } from './accessories/Elevator.js';
import { InfraRed } from './accessories/InfraRed.js';
import { Metric } from './accessories/Metric.js';
import { StateStream } from './stream.js';

export class HomebridgeHTTPPlugin implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    // 설정 블록 하나에 기기 여러 개(devices 배열)를 받으면 한 브리지(프로세스 하나)에 전부 올린다.
    // devices가 없으면 예전처럼 블록 하나 = 기기 하나.
    const devices = Array.isArray(this.config.devices) ? (this.config.devices as PlatformConfig[]) : null;
    if (devices === null) {
      this.addDevice(this, this.config);
      return;
    }
    for (const device of devices) {
      // 기기 클래스는 platform.config에서 자기 설정을 읽는다. 기기마다 config만 바꾼 겉껍질을 넘긴다.
      const scoped = Object.create(this, { config: { value: device, enumerable: true } }) as HomebridgeHTTPPlugin;
      try {
        this.addDevice(scoped, device);
      } catch (error) {
        this.log.error(`[ERROR] ${device.name}: ${error}`);
      }
    }
  }

  // (실험) 기기 종류 → 홈 서버 상태 키의 앞부분. 이 앞부분으로 시작하는 값이 바뀌면 그 기기의 상태가 바뀐 것이다.
  private keyPrefix(config: PlatformConfig): string | null {
    switch (config.type) {
      case 'light': return `light_${config.roomName}_`;
      case 'airConditioner': return `aircon_${config.roomName}_`;
      case 'heater': return `heat_${config.roomName}_`;
      case 'fan': return 'fan_';
      case 'cook': return 'cook';
      case 'lightall': return 'lightall';
      case 'elevator': return 'elevator_';
      default: return null;
    }
  }

  // (실험) 상태 스트림을 듣다가 이 기기의 상태가 바뀌면, 값을 다시 읽어 홈킷에 알린다.
  // 기기 클래스는 고치지 않는다: 각 특성의 읽기 처리기를 그대로 부르면 값이 달라졌을 때 Homebridge가 구독자에게 알린다.
  private watch(accessory: PlatformAccessory, config: PlatformConfig) {
    const prefix = this.keyPrefix(config);
    if (prefix === null) {
      return;
    }
    const stream = StateStream.get(this.log, 'http://localhost:8000/events');
    let timer: NodeJS.Timeout | null = null;
    stream.on('change', (key: string) => {
      if (!key.startsWith(prefix) || timer !== null) {
        return;
      }
      timer = setTimeout(() => { // 한꺼번에 바뀌는 값들을 모아 한 번만 읽는다
        timer = null;
        void this.refresh(accessory);
      }, 100);
    });
  }

  private async refresh(accessory: PlatformAccessory) {
    let reads = 0;
    for (const service of accessory.services) {
      if (service.UUID === this.Service.AccessoryInformation.UUID) {
        continue;
      }
      for (const characteristic of service.characteristics) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (characteristic as any).handleGetRequest();
          reads++;
        } catch {
          // 읽기 실패는 다음 변화 때 다시 시도된다
        }
      }
    }
    this.log.debug(`[push] ${accessory.displayName}: ${reads}개 특성 다시 읽음`);
  }

  private addDevice(platform: HomebridgeHTTPPlugin, config: PlatformConfig) {
    const uuid = this.api.hap.uuid.generate(config.name!);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    let accessory: PlatformAccessory;

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      accessory = existingAccessory;
    } else {
      this.log.info('Adding new accessory:', config.name);
      accessory = new this.api.platformAccessory(config.name!, uuid);
      accessory.context.config = config;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    if (this.config.push === true) {
      this.watch(accessory, config);
    }

    switch (config.type) {
      case 'light':
        new Light(platform, accessory);
        break;
      case 'airConditioner':
        new AirConditioner(platform, accessory);
        break;
      case 'fan':
        new Fan(platform, accessory);
        break;
      case 'cook':
        new Cook(platform, accessory);
        break;
      case 'lightall':
        new LightAll(platform, accessory);
        break;
      case 'heater':
        new Heater(platform, accessory);
        break;
      case 'elevator':
        new Elevator(platform, accessory);
        break;
      case 'infrared':
        new InfraRed(platform, accessory);
        break;
      case 'metric':
        new Metric(platform, accessory);
        break;
      default:
        this.log.error(`[ERROR] type not found: ${config.type}`);
    }
  }
}

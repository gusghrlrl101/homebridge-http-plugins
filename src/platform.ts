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

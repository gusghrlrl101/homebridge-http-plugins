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
    const uuid = this.api.hap.uuid.generate(this.config.name!);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    let accessory: PlatformAccessory;

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      accessory = existingAccessory;
    } else {
      this.log.info('Adding new accessory:', this.config.name);
      accessory = new this.api.platformAccessory(this.config.name!, uuid);
      accessory.context.config = this.config;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    switch (this.config.type) {
      case 'light':
        new Light(this, accessory);
        break;
      case 'airConditioner':
        new AirConditioner(this, accessory);
        break;
      case 'fan':
        new Fan(this, accessory);
        break;
      case 'cook':
        new Cook(this, accessory);
        break;
      case 'lightall':
        new LightAll(this, accessory);
        break;
      case 'heater':
        new Heater(this, accessory);
        break;
      case 'elevator':
        new Elevator(this, accessory);
        break;
      case 'infrared':
        new InfraRed(this, accessory);
      default:
        this.log.error(`[ERROR] type not found: ${this.config.type}`)
    }
  }
}

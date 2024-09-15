import { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { AirConditioner } from './accessories/AirConditioner.js';
import { Fan } from './accessories/Fan.js';

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
      case "airConditioner":
        new AirConditioner(this, accessory);
        break;
      case "fan":
        new Fan(this, accessory);
        break;
      default:
        this.log.error(`[ERROR] type not found: ${this.config.type}`)
    }
  }
}

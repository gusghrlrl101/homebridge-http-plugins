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

  private static readonly TYPES = ['light', 'airConditioner', 'fan', 'cook', 'lightall', 'heater', 'elevator', 'infrared', 'metric'];

  discoverDevices() {
    // 설정 블록 하나에 기기 여러 개(devices 배열)를 받으면 한 브리지(프로세스 하나)에 전부 올린다.
    // devices가 없으면 예전처럼 블록 하나 = 기기 하나.
    const devices = Array.isArray(this.config.devices) ? (this.config.devices as PlatformConfig[]) : null;
    if (devices === null) {
      this.addDevice(this, this.config);
      return;
    }
    const used = new Set<string>();
    for (const device of devices) {
      // 등록하기 전에 거른다: 이름이 없거나 겹치면 같은 기기로 등록되고, 종류가 틀리면 빈 기기가 홈 앱에 남는다
      if (typeof device.name !== 'string' || device.name === '') {
        this.log.error('[ERROR] name이 없는 기기 설정을 건너뜀');
        continue;
      }
      if (!HomebridgeHTTPPlugin.TYPES.includes(device.type)) {
        this.log.error(`[ERROR] ${device.name}: 모르는 type "${device.type}" — 건너뜀`);
        continue;
      }
      const uuid = this.api.hap.uuid.generate(device.name);
      if (used.has(uuid)) {
        this.log.error(`[ERROR] ${device.name}: 같은 name의 기기가 이미 있음 — 건너뜀`);
        continue;
      }
      used.add(uuid);
      // 기기 클래스는 platform.config와 platform.log를 쓴다. 기기마다 그 둘만 바꾼 겉껍질을 넘긴다.
      const scoped = Object.create(this, {
        config: { value: device, enumerable: true },
        log: { value: this.prefixed(device.name), enumerable: true },
      }) as HomebridgeHTTPPlugin;
      try {
        this.addDevice(scoped, device);
      } catch (error) {
        this.log.error(`[ERROR] ${device.name}: ${error}`);
      }
    }
    // 설정에서 빠진 기기는 홈 앱에서도 지운다(지우지 않으면 응답 없는 타일로 남는다)
    const stale = this.accessories.filter(accessory => !used.has(accessory.UUID));
    if (stale.length > 0) {
      this.log.info('설정에 없는 기기를 지움:', stale.map(accessory => accessory.displayName).join(', '));
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }

  // 한 브리지에 기기가 여럿이면 로그가 섞인다. 줄마다 기기 이름을 붙인다.
  private prefixed(name: string): Logging {
    const tag = (message: unknown) => `[${name}] ${message}`;
    const log = this.log;
    return Object.assign((message: string, ...rest: unknown[]) => log(tag(message), ...rest), {
      prefix: log.prefix,
      info: (message: string, ...rest: unknown[]) => log.info(tag(message), ...rest),
      success: (message: string, ...rest: unknown[]) => (log.success ?? log.info)(tag(message), ...rest),
      warn: (message: string, ...rest: unknown[]) => log.warn(tag(message), ...rest),
      error: (message: string, ...rest: unknown[]) => log.error(tag(message), ...rest),
      debug: (message: string, ...rest: unknown[]) => log.debug(tag(message), ...rest),
      log: (level: Parameters<Logging['log']>[0], message: string, ...rest: unknown[]) => log.log(level, tag(message), ...rest),
    }) as Logging;
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

  private static readonly SETTLE_MS = 100; // 한꺼번에 바뀌는 값들을 모아 한 번만 읽는다
  private static readonly HOLD_MS = 3000; // 홈킷이 방금 쓴 특성은 이만큼 다시 읽지 않는다(명령이 버스에 반영되기 전의 옛 값을 알리지 않게)
  private readonly written = new WeakMap<Characteristic, number>(); // 특성 → 홈킷이 마지막으로 쓴 시각
  private readonly tracked = new WeakSet<Characteristic>();
  private warnedNoRefresh = false;

  // (실험) 상태 스트림을 듣다가 이 기기의 상태가 바뀌면, 값을 다시 읽어 홈킷에 알린다.
  // 기기 클래스는 고치지 않는다: 각 특성의 읽기 처리기를 그대로 부르면 값이 달라졌을 때 Homebridge가 구독자에게 알린다.
  private watch(accessory: PlatformAccessory, config: PlatformConfig) {
    const prefix = this.keyPrefix(config);
    if (prefix === null) {
      return;
    }
    const stream = StateStream.get(this.log, 'http://localhost:8000/events');
    // 다시 읽기는 기기당 한 번에 하나만. 도는 중에 또 바뀌면 끝난 뒤 한 번 더 돈다
    const job = {
      timer: null as NodeJS.Timeout | null,
      running: false,
      again: false,
      schedule: (delay: number) => {
        if (job.timer === null) {
          job.timer = setTimeout(() => void job.run(), delay);
        }
      },
      run: async () => {
        job.timer = null;
        if (job.running) {
          job.again = true;
          return;
        }
        job.running = true;
        try {
          const held = await this.refresh(accessory);
          if (held) {
            job.schedule(HomebridgeHTTPPlugin.HOLD_MS); // 건너뛴 특성은 조금 뒤에 다시 읽는다
          }
        } finally {
          job.running = false;
          if (job.again) {
            job.again = false;
            job.schedule(HomebridgeHTTPPlugin.SETTLE_MS);
          }
        }
      },
    };
    stream.on('change', (key: string) => {
      if (key.startsWith(prefix)) {
        job.schedule(HomebridgeHTTPPlugin.SETTLE_MS);
      }
    });
  }

  /** 기기의 특성을 다시 읽는다. 홈킷이 방금 쓴 특성을 건너뛰었으면 true. */
  private async refresh(accessory: PlatformAccessory): Promise<boolean> {
    let reads = 0;
    let held = false;
    for (const service of accessory.services) {
      if (service.UUID === this.Service.AccessoryInformation.UUID) {
        continue;
      }
      for (const characteristic of service.characteristics) {
        if (!this.tracked.has(characteristic)) {
          this.tracked.add(characteristic);
          characteristic.on('change', change => {
            if (change.reason === 'write') {
              this.written.set(characteristic, Date.now());
            }
          });
        }
        if (Date.now() - (this.written.get(characteristic) ?? 0) < HomebridgeHTTPPlugin.HOLD_MS) {
          held = true;
          continue;
        }
        if (typeof characteristic.handleGetRequest !== 'function') {
          if (!this.warnedNoRefresh) {
            this.warnedNoRefresh = true;
            this.log.warn('[push] 이 Homebridge 버전에서는 값을 다시 읽는 방법이 없어 알림을 보낼 수 없음');
          }
          return false;
        }
        try {
          await characteristic.handleGetRequest();
          reads++;
        } catch {
          // 읽기 실패는 다음 변화 때 다시 시도된다
        }
      }
    }
    this.log.debug(`[push] ${accessory.displayName}: ${reads}개 특성 다시 읽음`);
    return held;
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

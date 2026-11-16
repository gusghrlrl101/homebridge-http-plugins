import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { PLUGIN_NAME } from '../settings.js';

// 월패드 계량값(전기·냉수·온수·난방)을 Matter 콘센트로 띄워 홈 앱(iOS 27+) 타일에 실시간 숫자로 보여 준다.
// 홈 앱은 '콘센트' 기기의 전력(W)만 타일에 숫자로 보여 준다. 그래서 수도·온수·난방도 같은 방식으로 띄우되,
// 타일 숫자는 단위와 상관없이 월패드 원시값이고(이름으로 구분), 에너지(kWh) 누적은 실제 전기에만 붙인다.
// 예전 별도 플러그인(homebridge-hyunho-matter)과 플랫폼 이름·UUID 재료가 같아서, Homebridge가 캐시된 기기를
// 이 플러그인으로 넘긴다(홈 앱에서 다시 추가할 필요 없음).
export const MATTER_PLATFORM_NAME = 'HyunhoMatter';

const VM_BASE = 'http://localhost:8428';
const POWER_MS = 5_000; // 순간값 확인 주기(게이트웨이가 전기는 10초, 수도·온수 20초, 난방 60초마다 읽어 VictoriaMetrics에 쌓는다)
const ENERGY_MS = 60_000; // 누적 에너지 갱신 주기(Homebridge 문서 권장: 1분 정도)
const VOLTAGE_MV = 220_000; // 한국 가정용 220 V. 월패드는 전압·전류를 주지 않아 공칭값과 전력으로 계산한다
const ENERGY_EPOCH = Date.parse('2026-11-01T00:00:00+09:00'); // 누적 에너지 기준 시각: 이때부터 순간 전력을 적분
// 저장소 폴더에 이 파일이 있으면, 브리지가 온라인이 된 뒤 새 기기를 뺐다가 다시 넣는다(한 번 실행 후 삭제).
// 브리지가 켜지는 도중(온라인 전)에 바뀐 기기 목록은 홈 허브가 놓치기 때문이다(실측: 새 기기가 홈 앱에 안 보임).
const READD_FLAG = 'hyunho-matter-readd';

interface Meter {
  key: string; // UUID 재료라 바꾸면 홈 앱에서 새 기기가 된다
  label: string;
  metric: string;
  // true: 실제 누적 전력량. 'zero': 0 고정. 홈 앱은 누적 에너지 항목이 있어야 타일에 숫자를 보여 준다
  // (실측: 같은 값이라도 항목이 없는 쪽은 '켜짐'만 보임). 전기가 아닌 값은 0으로 둬 집 전체 사용량에 안 더해지게 한다.
  energy: true | 'zero';
}

const METERS: Meter[] = [
  { key: 'outlet', label: '전력 콘센트', metric: 'electro', energy: true },
  { key: 'water_e', label: '냉수', metric: 'water', energy: 'zero' },
  { key: 'hot_water_e', label: '온수', metric: 'hot_water', energy: 'zero' },
  { key: 'heat_e', label: '난방', metric: 'heat', energy: 'zero' },
];

// Homebridge 2.5 Matter API 중 이 플랫폼이 쓰는 부분. devDependency의 homebridge 타입(2.0)에는 전력·에너지
// 클러스터가 없어서 직접 적는다. 실행은 Homebridge 2.2 이상(전력·에너지 클러스터 지원)에서만 의미가 있다.
type MatterAccessoryDef = Record<string, unknown> & { UUID: string; displayName?: string };
interface MatterLike {
  deviceTypes: Record<string, unknown>;
  registerPlatformAccessories(plugin: string, platform: string, accessories: MatterAccessoryDef[]): Promise<void>;
  unregisterPlatformAccessories(plugin: string, platform: string, accessories: MatterAccessoryDef[]): Promise<void>;
  updateAccessoryState(uuid: string, cluster: string, attributes: Record<string, unknown>): Promise<void>;
}

interface VmResponse {
  data?: { result?: { value?: [number, string] }[] };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export class MatterMeters implements DynamicPlatformPlugin {
  private readonly meters: (Meter & { uuid: string; value: number | null })[];
  private readonly cached: MatterAccessoryDef[] = [];
  private registered: MatterAccessoryDef[] = [];
  private lastEnergy: number | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly log: Logging,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    this.meters = METERS.map(m => ({ ...m, uuid: api.hap.uuid.generate(`hyunho-matter:power2:${m.key}`), value: null }));
    api.on('didFinishLaunching', () => {
      this.start().catch(err => log.error('Matter 등록 실패:', String(err)));
    });
    api.on('shutdown', () => this.timers.forEach(clearInterval));
  }

  private get matter(): MatterLike | undefined {
    return (this.api as unknown as { matter?: MatterLike }).matter;
  }

  // Homebridge는 configureAccessory가 있는 플랫폼만 '동적 플랫폼'으로 인정한다. 없으면 캐시된 Matter 기기를
  // 주인 없는 기기로 보고 재시작 때마다 지웠다가 다시 만든다(홈 앱에는 기기가 사라졌다 새로 생기는 것으로 보임).
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug('HAP 캐시 기기 무시:', accessory.displayName);
  }

  configureMatterAccessory(accessory: { UUID: string; displayName?: string }) {
    this.cached.push(accessory as unknown as MatterAccessoryDef);
  }

  private async start() {
    const matter = this.matter;
    if (!matter) {
      this.log.error('이 브리지에 Matter가 꺼져 있습니다(_bridge.matter 필요).');
      return;
    }
    const flag = join(this.api.user.storagePath(), READD_FLAG);
    const readd = existsSync(flag);
    if (readd) {
      unlinkSync(flag);
    }
    const keep = this.meters.map(m => m.uuid);
    const stale = this.cached.filter(a => !keep.includes(a.UUID));
    if (stale.length && !readd) {
      await this.remove(stale);
    }

    await this.register(matter);
    this.timers = [
      setInterval(() => this.pushValues(matter).catch(err => this.log.warn('순간값 갱신 실패:', String(err))), POWER_MS),
      setInterval(() => this.pushEnergy(matter).catch(err => this.log.warn('에너지 갱신 실패:', String(err))), ENERGY_MS),
    ];
    if (readd) {
      setTimeout(() => this.readd(matter, stale).catch(err => this.log.warn('재등록 실패:', String(err))), 20_000);
    }
  }

  private async register(matter: MatterLike) {
    for (const m of this.meters) {
      m.value = await this.readValue(m);
    }
    const energy = await this.readEnergy();
    this.lastEnergy = energy;
    this.registered = this.meters.map(m => ({
      UUID: m.uuid,
      displayName: m.label,
      deviceType: matter.deviceTypes.OnOffOutlet,
      manufacturer: 'HyunHo Home',
      model: 'Wallpad Meter',
      serialNumber: `meter-${m.key}`,
      context: {},
      clusters: {
        onOff: { onOff: true },
        electricalPowerMeasurement: this.powerState(m.value), // mV, mA, mW
        electricalEnergyMeasurement: { cumulativeEnergyImported: { energy: this.energyOf(m, energy) } }, // mWh
      },
      // 끊을 실제 콘센트가 없다: 끄기를 받으면 잠시 뒤 다시 켜짐으로 되돌린다(오류를 던지면 홈 앱에 실패로 보임)
      handlers: {
        onOff: {
          on: async () => {},
          off: async () => {
            this.log.info(`[${m.label}] 끄기 요청 무시(계량 전용)`);
            setTimeout(() => matter.updateAccessoryState(m.uuid, 'onOff', { onOff: true }).catch(() => {}), 1000);
          },
        },
      },
    }));
    await matter.registerPlatformAccessories(PLUGIN_NAME, MATTER_PLATFORM_NAME, this.registered);
    // 캐시에서 복원된 기기는 위 clusters 값이 무시되고 저장된 값이 남는다(문서: 시작값은 기본값일 뿐).
    // 그래서 등록 직후 지금 값을 한 번 직접 밀어 준다.
    for (const m of this.meters) {
      await matter.updateAccessoryState(m.uuid, 'electricalPowerMeasurement', this.powerState(m.value));
      await matter.updateAccessoryState(m.uuid, 'electricalEnergyMeasurement',
        { cumulativeEnergyImported: { energy: this.energyOf(m, energy) } });
    }
    this.log.info('계량 기기 등록:', this.meters.map(m => `${m.label}=${m.value}`).join(', '),
      `누적 전력량 ${energy === null ? '?' : (energy / 1e6).toFixed(1)}kWh`);
  }

  private async remove(accessories: MatterAccessoryDef[]) {
    await this.matter?.unregisterPlatformAccessories(PLUGIN_NAME, MATTER_PLATFORM_NAME, accessories);
    this.log.info('기기 제거:', accessories.map(a => a.displayName ?? a.UUID).join(', '));
  }

  // 이미 홈에 있던 기기(캐시에서 복원된 것)는 건드리지 않고, 새로 생긴 기기와 없어진 기기만 다시 알린다
  private async readd(matter: MatterLike, stale: MatterAccessoryDef[]) {
    const fresh = this.registered.filter(a => !this.cached.some(c => c.UUID === a.UUID));
    if (!stale.length && !fresh.length) {
      return;
    }
    await this.remove([...stale, ...fresh]);
    await new Promise(r => setTimeout(r, 5_000));
    if (fresh.length) {
      await matter.registerPlatformAccessories(PLUGIN_NAME, MATTER_PLATFORM_NAME, fresh);
    }
    this.log.info('온라인 상태에서 목록 변경 알림: 추가', fresh.map(a => a.displayName).join(', ') || '-',
      '/ 제거', stale.map(a => a.displayName ?? a.UUID).join(', ') || '-');
  }

  private energyOf(m: Meter, energy: number | null): number {
    return m.energy === 'zero' ? 0 : (energy ?? 0);
  }

  // 타일 숫자는 activePower(W). 전압·전류도 Homebridge 공식 예제(homebridge-matter OnOffOutletAccessory)처럼 함께 보낸다
  private powerState(value: number | null) {
    if (value === null) {
      return { voltage: null, activeCurrent: null, activePower: null };
    }
    return { voltage: VOLTAGE_MV, activeCurrent: Math.round(value * 1000 / VOLTAGE_MV * 1000), activePower: value * 1000 };
  }

  // VictoriaMetrics는 기본으로 최근 30초 안에 들어온 값을 조회 결과에서 뺀다(-search.latencyOffset).
  // 실시간 표시가 목적이라 latency_offset=1ms로 가장 최근 값까지 읽는다(실측: 기본 32초 묵은 값 → 1ms면 방금 값).
  private async vmQuery(query: string): Promise<number | null> {
    const d = await getJson<VmResponse>(`${VM_BASE}/api/v1/query?query=${encodeURIComponent(query)}&latency_offset=1ms`);
    const value = Number(d?.data?.result?.[0]?.value?.[1]);
    return Number.isFinite(value) ? value : null;
  }

  // 월패드 순간값(최근 10분 안의 마지막 값). 없으면 null(= 지금 읽을 수 없음)
  private async readValue(m: Meter): Promise<number | null> {
    const value = await this.vmQuery(`last_over_time(metric{name="${m.metric}"}[10m])`);
    return value === null ? null : Math.round(value);
  }

  // 기준 시각부터의 누적 전력량(mWh): 순간 전력(W)을 시간 적분(W·s)
  private async readEnergy(): Promise<number | null> {
    const seconds = Math.floor((Date.now() - ENERGY_EPOCH) / 1000);
    const ws = await this.vmQuery(`integrate(metric{name="electro"}[${seconds}s])`);
    return ws === null ? null : Math.round(ws / 3.6); // W·s → mWh (1 mWh = 3.6 W·s)
  }

  private async pushValues(matter: MatterLike) {
    for (const m of this.meters) {
      const value = await this.readValue(m);
      if (value === m.value) {
        continue;
      }
      m.value = value;
      await matter.updateAccessoryState(m.uuid, 'electricalPowerMeasurement', this.powerState(value));
    }
  }

  private async pushEnergy(matter: MatterLike) {
    const energy = await this.readEnergy();
    if (energy === null || energy === this.lastEnergy) {
      return;
    }
    this.lastEnergy = energy;
    const outlet = this.meters.find(m => m.energy === true);
    if (outlet) {
      await matter.updateAccessoryState(outlet.uuid, 'electricalEnergyMeasurement', { cumulativeEnergyImported: { energy } });
    }
  }
}

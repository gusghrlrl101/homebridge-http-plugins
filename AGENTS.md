# AGENTS.md

AI 코딩 에이전트를 위한 이 저장소 안내서입니다. (사람도 읽기 좋게 작성됨)

## 프로젝트 개요

**homebridge-http-plugins** 는 개인용 [Homebridge](https://homebridge.io) **다이내믹 플랫폼 플러그인**입니다.
HomeKit의 명령을 로컬 백엔드(`http://localhost:8000`, 별도 서비스 "HyunHo Home" API — 이 저장소 밖)로 **HTTP GET 호출**해 집안 가전을 제어합니다.

- 언어/런타임: **TypeScript (ESM)**, Node **22/24**, Homebridge **^1.8 || ^2.0** (HAP-NodeJS v2)
- 통신: `axios` (타임아웃 2초)
- 외부 의존성(런타임): `axios` 하나뿐

## 아키텍처

```
src/
  index.ts          # api.registerPlatform(PLATFORM_NAME, HomebridgeHTTPPlugin)
  settings.ts       # PLATFORM_NAME='HomebridgeHTTPPlugin', PLUGIN_NAME='homebridge-http-plugins'
  platform.ts       # DynamicPlatformPlugin. discoverDevices()에서 config.type 으로 분기해 accessory 생성
  model.ts          # enum: Room(master/living/kitchen/guest), Active(on/off), FanSpeed(off/low/mid/high/auto)
  utils.ts          # 공용 axios 인스턴스 (timeout 2000ms)
  accessories/      # 기기 타입별 클래스 (각자 HAP 서비스 + onGet/onSet 핸들러)
```

- **config 1블록 = 기기 1개** (`config.schema.json`의 platform alias `HomebridgeHTTPPlugin`, `singular: false`).
- `platform.ts`의 `discoverDevices()`가 `config.name`으로 UUID를 만들고 `config.type` 에 따라 아래 클래스를 인스턴스화합니다.
- 각 accessory 클래스 생성자 시그니처: `constructor(platform: HomebridgeHTTPPlugin, accessory: PlatformAccessory)`.

## 기기 타입 (config `type`) → HAP 서비스 / 백엔드 엔드포인트

| `type` | 클래스 | HAP 서비스 | 주요 백엔드 호출 (`http://localhost:8000`) |
|---|---|---|---|
| `light` | Light | Lightbulb × N (방별 master:2/living:3/kitchen:2/guest:4) | `/light/power/get\|set?room_name&device_num&state` |
| `airConditioner` | AirConditioner | HeaterCooler(냉방) | `/aircon/{power,current_temp,target_temp,wind_power,wind_vertical}/get\|set?room_name` |
| `fan` | Fan | Fanv2 | `/fan/power/get\|set`, `/fan/bipass/get\|set` (속도 off/low/mid/high) |
| `heater` | Heater | HeaterCooler(난방) | `/heat/{power,current_temp,target_temp}/get\|set?room_name` |
| `cook` | Cook | Outlet | `/cook/power/get`, `/cook/power/lock` (안전상 끄기/잠금만) |
| `lightall` | LightAll | Switch | `/lightall/power/get\|set` |
| `elevator` | Elevator | Switch(호출) + OccupancySensor(도착) | `/elevator/call`, `/elevator/arrived` |
| `infrared` | InfraRed | Lightbulb(토글) | `/aqara/click?device_name&key_num` (IR 송신, 단방향) |
| `metric` | Metric | LightSensor(수치 게이지로 전용) | `/metric/get?metric_name` (값 0.0001~100000 클램프) |

config 필드: `name`(필수), `type`(필수, 위 enum), `roomName`(master/living/kitchen/guest), `metricName`(electro/unknown/water/hot_water/heat — `type=metric`일 때).

## 개발/빌드

```bash
npm install
npm run build     # rimraf ./dist && tsc  → dist/ 생성 (main: dist/index.js)
npm run lint      # eslint . --max-warnings=0
npm run watch     # build + npm link + nodemon (homebridge -I -D 실행)
```

- **CI는 `npm ci`를 사용** → `package.json` 변경 시 `package-lock.json`을 **npm 11 기준으로** 동기화할 것 (`npm install` 후 커밋). 안 맞으면 CI가 `npm ci`에서 실패합니다.

## 코드 컨벤션 (지켜야 빌드/린트 통과)

- **ESM**: 상대 import는 반드시 **`.js` 확장자** 포함 — 예: `import { Light } from './accessories/Light.js'` (tsconfig `module/moduleResolution: nodenext`).
- TypeScript **strict**, target ES2022.
- ESLint flat config(`eslint.config.js`): **작은따옴표**, 2칸 들여쓰기(SwitchCase:1), **세미콜론 필수**, 멀티라인 trailing comma, max-len 160.
- **Homebridge v2 / HAP v2**: `Service`/`Characteristic`는 `this.platform.Service` / `this.platform.Characteristic`(= `api.hap.*`)로 접근. **Promise 스타일** `.onGet()/.onSet()` 사용.
- 로깅은 `this.platform.log.info/error/debug` 사용 (`console.*` 금지).
- HTTP는 `utils.ts`의 공용 `api`(axios) 인스턴스 사용.

## 새 기기 타입 추가 절차

1. `src/accessories/<Type>.ts` 에 `(platform, accessory)` 생성자 패턴으로 클래스 작성. 적절한 HAP 서비스/특성을 고르고 `onGet/onSet`에서 `api`로 백엔드 호출.
2. `src/platform.ts`의 `discoverDevices()` switch에 `case '<type>':` 추가.
3. `config.schema.json`의 `type.oneOf`에 항목 추가 (+ 필요한 config 필드).

## 릴리스 (중요 — 수동 npm publish 하지 말 것)

자동화돼 있습니다. 흐름:

1. PR 작성.
2. 배포할 거면 **Actions → "Prepare merge" → Run workflow** (PR 브랜치 선택, `level` = patch/minor/major/none).
   - none이 아니면 `package.json` **버전 bump 커밋**을 PR 브랜치에 추가하고, lint/build(Node 22·24) 후 결과를 **`ci`** 커밋 상태로 보고.
3. `main`은 브랜치 보호로 **`ci` 통과해야 머지** 가능.
4. 머지되면 `release.yml`이 버전이 npm 게시본보다 새로우면 **npm publish(OIDC, 토큰 없음) + git 태그 + GitHub Release** 를 자동 수행.

워크플로우: `.github/workflows/prepare-merge.yml`(버튼), `release.yml`(머지 시 게시), `build.yml`(main push 검증).

## 알려진 이슈 / 주의 (개선 시 고려)

- HTTP 핸들러에 **try/catch 없음** → 백엔드/네트워크 오류가 그대로 전파. 개선 시 `HapStatusError(SERVICE_COMMUNICATION_FAILURE)` 권장.
- accessory **UUID가 `config.name`만으로 생성** → 이름이 겹치면 충돌. **이름은 고유해야 함**.
- `roomName` **미검증** → 누락/오타 시 비정상 동작(Light는 서비스 0개, AC/Heater는 URL에 `room_name=undefined`).
- **낙관적 상태 캐시**가 stale하면 명령을 건너뛸 수 있음.
- 백엔드(`localhost:8000`)는 **별도 서비스**(이 저장소에 없음). 테스트는 빌드/린트 위주.
- 자동화 테스트(unit/e2e) 없음.

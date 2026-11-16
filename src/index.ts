import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings.js';
import { HomebridgeHTTPPlugin } from './platform.js';
import { MATTER_PLATFORM_NAME, MatterMeters } from './matter/MatterMeters.js';

export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, HomebridgeHTTPPlugin);
  // 월패드 계량값을 Matter 콘센트 타일로 보여 주는 플랫폼(Matter를 켠 차일드 브리지에서만 동작)
  api.registerPlatform(MATTER_PLATFORM_NAME, MatterMeters);
};

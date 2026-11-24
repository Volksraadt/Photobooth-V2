/**
 * Writes the local dev booth config served at /booth-config.json (see vite.config.ts).
 * Keeps an existing file (so manual edits survive) unless --reset is passed.
 *
 *   pnpm --filter @pb/kiosk config:init      # regenerate from createDefaultBoothConfig()
 *   PB_KIOSK_CONFIG=path/to/config.json pnpm --filter @pb/kiosk dev
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createDefaultBoothConfig, hashAdminPin } from '@pb/schema';
import { DEV_ADMIN_PIN, devConfigPath } from './dev-config-path.ts';

const path = devConfigPath();
const reset = process.argv.includes('--reset');

if (existsSync(path) && !reset) {
  console.log(`[kiosk] booth config: ${path}`);
} else {
  let n = 0;
  const config = createDefaultBoothConfig({
    boothId: 'dev-booth',
    boothName: 'Photobooth Demo',
    // Readable, stable ids so the JSON is easy to edit by hand.
    idFactory: () => `el-${String(++n).padStart(3, '0')}`,
  });
  config.admin.pinHash = await hashAdminPin(DEV_ADMIN_PIN);
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`[kiosk] wrote default booth config to ${path} (admin PIN ${DEV_ADMIN_PIN})`);
}

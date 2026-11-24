import { resolve } from 'node:path';

/** Admin PIN of the generated dev config only. Real booths get their PIN from Studio. */
export const DEV_ADMIN_PIN = '1234';

export function devConfigPath(): string {
  const kioskDir = resolve(import.meta.dirname, '..');
  const fromEnv = process.env.PB_KIOSK_CONFIG;
  return fromEnv ? resolve(kioskDir, fromEnv) : resolve(kioskDir, 'booth-config.local.json');
}

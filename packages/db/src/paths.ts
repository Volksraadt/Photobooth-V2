import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = resolve(here, '../drizzle');
export const PACKAGE_DIR = resolve(here, '..');
export const REPO_ROOT = resolve(here, '../../..');

/** Load the repo-root .env into process.env (existing vars win). */
export function loadRootEnv(): void {
  const file = resolve(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

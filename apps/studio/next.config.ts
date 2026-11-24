import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Single .env at the repo root, shared with apps/api and packages/db scripts.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  transpilePackages: ['@pb/schema', '@pb/db', '@pb/ui', '@pb/crypto', '@pb/renderer'],
  serverExternalPackages: ['postgres'],
  turbopack: { root: resolve(import.meta.dirname, '../..') },
};

export default config;

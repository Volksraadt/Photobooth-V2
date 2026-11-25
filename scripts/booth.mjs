// Booth laptop against the deployed API: agent + kiosk + worker only (no local API/Studio).
//   pnpm booth                      → API from PB_BOOTH_API_URL in .env, else the Vercel API
//   pnpm booth https://other-api    → that API
// The worker still uses DATABASE_URL / Supabase storage from .env (same project as the API).
// Kiosk: open http://localhost:5173 (config comes from the agent).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fileEnv = existsSync(resolve(root, '.env'))
  ? Object.fromEntries(
      readFileSync(resolve(root, '.env'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    )
  : {};
const api = (
  process.argv[2] ??
  process.env.PB_BOOTH_API_URL ??
  fileEnv.PB_BOOTH_API_URL ??
  'https://photobooth-api-one.vercel.app'
).replace(/\/$/, '');

const env = {
  ...process.env,
  // agent
  PB_API_URL: api,
  PB_SHORT_LINK_BASE: api,
  // worker (short links in uploads / QR)
  PB_PUBLIC_API_URL: api,
  // kiosk (Vite)
  VITE_SHORT_LINK_BASE: api,
  VITE_CONFIG_SOURCE: 'agent',
};

console.log(`[booth] API ${api} · Kiosk http://localhost:5173`);
const child = spawn(
  'pnpm',
  [
    'exec',
    'turbo',
    'run',
    'dev',
    '--filter=@pb/agent',
    '--filter=@pb/kiosk',
    '--filter=@pb/worker',
  ],
  { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' },
);
child.on('exit', (code) => process.exit(code ?? 0));

// Writes the environment of the two Vercel projects from the repo-root .env:
//   .data/vercel/api.env     → Vercel project "api"    (Root Directory apps/api)
//   .data/vercel/studio.env  → Vercel project "studio" (Root Directory apps/studio)
// Paste each file in Vercel → Project → Settings → Environment Variables ("Import .env").
// .data/ is git-ignored. Secrets go to the API only (CLAUDE.md invariants); Studio gets what it
// reads itself. Usage: node scripts/vercel-env.mjs https://<api>.vercel.app https://<studio>.vercel.app
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const apiUrl = (process.argv[2] ?? 'https://GANTI-api.vercel.app').replace(/\/$/, '');
const studioUrl = (process.argv[3] ?? 'https://GANTI-studio.vercel.app').replace(/\/$/, '');

// Serverless: many short-lived instances → Supabase transaction pooler (port 6543), one client
// each. `prepare` is turned off automatically for pooler.supabase.com hosts (packages/db).
const dbUrl = (env.DATABASE_URL ?? '').replace(/(pooler\.supabase\.com):5432\b/, '$1:6543');
if (!/pooler\.supabase\.com:6543/.test(dbUrl))
  console.warn('[vercel-env] DATABASE_URL is not a Supabase pooler URL; check it by hand.');

const pick = (keys) => keys.filter((k) => env[k]).map((k) => [k, env[k]]);
const common = [
  ['DATABASE_URL', dbUrl],
  ['PB_DB_POOL_MAX', '1'],
  ['PB_LOCAL_DB', '0'],
  ['PB_AUTH_MODE', 'supabase'],
  ...pick(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'PB_PLATFORM_ADMINS']),
];
const api = [
  ...common,
  ...pick([
    'SUPABASE_SERVICE_ROLE_KEY',
    'SECRET_MASTER_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'PB_BILLING_MIDTRANS_SERVER_KEY',
    'PB_BILLING_MIDTRANS_SIGNATURE_KEY',
    'PB_BILLING_MIDTRANS_PREVIOUS_SIGNATURE_KEY',
    'PB_BILLING_MIDTRANS_ENV',
    'PB_STORAGE_BUCKET',
  ]),
  ['PB_STORAGE', 'supabase'],
  ['PB_PUBLIC_API_URL', apiUrl],
  ['PB_STUDIO_URL', studioUrl],
  ['GOOGLE_REDIRECT_URI', `${apiUrl}/oauth/google/callback`],
  // Vercel puts the client address in X-Forwarded-For (rate limits per client).
  ['PB_TRUST_PROXY', '1'],
];
const studio = [...common, ['PB_API_URL', apiUrl], ['PB_MEDIA_BASE_URL', studioUrl]];

const forbiddenInStudio = [
  'SECRET_MASTER_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_CLIENT_SECRET',
  'PB_BILLING_MIDTRANS_SERVER_KEY',
];
for (const [k] of studio)
  if (forbiddenInStudio.includes(k)) throw new Error(`${k} must not go to Studio`);

const out = resolve(root, '.data/vercel');
mkdirSync(out, { recursive: true });
const write = (name, rows) =>
  writeFileSync(resolve(out, name), rows.map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
write('api.env', api);
write('studio.env', studio);
console.log(
  `[vercel-env] wrote ${out}/api.env (${api.length} vars) and studio.env (${studio.length} vars)`,
);
console.log(`[vercel-env] API ${apiUrl} · Studio ${studioUrl}`);

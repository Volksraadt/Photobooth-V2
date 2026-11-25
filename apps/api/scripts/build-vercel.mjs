// Bundles the API into one Node function using Vercel's Build Output API (v3):
//   .vercel/output/config.json                 every path → the function
//   .vercel/output/functions/index.func/       bundled ESM + .vc-config.json
// Workspace packages are TypeScript sources, so they are bundled here instead of relying on
// Vercel's per-file TypeScript build. Run from apps/api: `pnpm build:vercel`.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.vercel/output');
const fn = resolve(out, 'functions/index.func');

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/vercel.ts')],
  outfile: resolve(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
  // CommonJS dependencies inside an ESM bundle still call require()/__dirname.
  banner: {
    js: [
      "import { createRequire as __pbCreateRequire } from 'node:module';",
      "import { fileURLToPath as __pbFileURLToPath } from 'node:url';",
      "import { dirname as __pbDirname } from 'node:path';",
      'const require = __pbCreateRequire(import.meta.url);',
      'const __filename = __pbFileURLToPath(import.meta.url);',
      'const __dirname = __pbDirname(__filename);',
    ].join('\n'),
  },
});

writeFileSync(
  resolve(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // Device SSE streams end here; the agent reconnects (and polls meanwhile).
      maxDuration: 300,
      // Same region as the Supabase project (Singapore).
      regions: ['sin1'],
    },
    null,
    2,
  ),
);
writeFileSync(
  resolve(out, 'config.json'),
  JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index' }] }, null, 2),
);
console.log(`[build-vercel] wrote ${out}`);

/**
 * Stages the agent as a Tauri sidecar for the kiosk installer (run on the target OS):
 *
 *   src-tauri/binaries/pb-agent-<rust target triple>[.exe]   ← this Node runtime (Node 24)
 *   src-tauri/resources/agent/main.mjs                       ← agent bundle (esbuild)
 *   src-tauri/resources/agent/print-image.ps1                ← Windows spooler script
 *   src-tauri/resources/agent/node_modules/{sharp,@napi-rs/canvas,…}  ← native modules for this OS
 *
 * Usage: pnpm --filter @pb/agent bundle
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const agentDir = resolve(import.meta.dirname, '..');
const tauriDir = resolve(agentDir, '../kiosk/src-tauri');
const outDir = join(tauriDir, 'resources', 'agent');
const binDir = join(tauriDir, 'binaries');

/** Native modules can't be bundled; they are installed next to the bundle for this platform. */
const NATIVE = ['sharp', '@napi-rs/canvas'];

function versionOf(pkg: string): string {
  const compositor = JSON.parse(
    readFileSync(resolve(agentDir, '../../packages/compositor/package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> };
  return compositor.dependencies[pkg] ?? 'latest';
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(binDir, { recursive: true });

await build({
  entryPoints: [join(agentDir, 'src/main.ts')],
  outfile: join(outDir, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: NATIVE,
  sourcemap: 'linked',
  legalComments: 'none',
  // CJS dependencies (ws, …) call require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire as __pbCreateRequire } from 'node:module'; const require = __pbCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

copyFileSync(join(agentDir, 'src/print/print-image.ps1'), join(outDir, 'print-image.ps1'));

writeFileSync(
  join(outDir, 'package.json'),
  JSON.stringify(
    {
      name: 'pb-agent-runtime',
      private: true,
      type: 'module',
      dependencies: Object.fromEntries(NATIVE.map((p) => [p, versionOf(p)])),
    },
    null,
    2,
  ),
);
// npm (not pnpm): a flat node_modules with only this platform's prebuilt binaries (optional
// dependencies; no install scripts needed). Settings inherited from an outer pnpm run
// (npm_config_*) would leak into npm, so the child gets a clean environment.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^npm_|^pnpm_/i.test(k)),
);
execFileSync(
  process.platform === 'win32'
    ? 'npm.cmd install --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock'
    : 'npm',
  process.platform === 'win32'
    ? []
    : ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'],
  { cwd: outDir, stdio: 'inherit', shell: process.platform === 'win32', env },
);

const triple = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1];
if (!triple) throw new Error('rustc -vV did not report a host triple');
const ext = process.platform === 'win32' ? '.exe' : '';
const target = join(binDir, `pb-agent-${triple}${ext}`);
mkdirSync(dirname(target), { recursive: true });
copyFileSync(process.execPath, target);
console.log(`[bundle] agent staged in ${outDir}; node runtime → ${target}`);

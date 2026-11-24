import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Agent } from './agent';
import { AGENT_VERSION, optionsFromEnv } from './options';

// Dev: share the repo .env (PB_API_URL etc.). The packaged sidecar gets env from Tauri.
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const options = optionsFromEnv();
const agent = new Agent(options);

process.on('uncaughtException', (err) => {
  console.error('[agent] uncaught exception', err);
  try {
    agent.store.event({
      level: 'error',
      kind: 'crash',
      message: String(err?.stack ?? err).slice(0, 2000),
    });
  } catch {
    // store unavailable
  }
  process.exit(1);
});

const shutdown = () => {
  void agent.stop().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Sidecar: exit when the kiosk shell is gone (killed or crashed), so no orphan keeps the ports.
const parentPid = Number(process.env.PB_PARENT_PID);
if (parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      console.warn(`[agent] parent ${parentPid} is gone; exiting`);
      shutdown();
    }
  }, 2000).unref();
}

agent
  .start()
  .then(() => {
    console.log(
      `[agent] ${AGENT_VERSION} kiosk API http://127.0.0.1:${agent.localPort} · camera LAN :${agent.lanPort} · data ${options.dataDir} · api ${options.apiBase}`,
    );
  })
  .catch((err: unknown) => {
    console.error('[agent] failed to start', err);
    process.exit(1);
  });

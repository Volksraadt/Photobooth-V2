import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { BoothConfigEvents, listenBoothConfig } from '@pb/db';
import { createAppFromEnv } from './server';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.API_PORT ?? 8787);
const configEvents = new BoothConfigEvents();
const app = createAppFromEnv(configEvents);

// Publish → pg_notify → SSE to the booth's devices. Retries until the database is up;
// devices keep polling /device/config meanwhile.
async function startListening(attempt = 1): Promise<void> {
  try {
    await listenBoothConfig(process.env.DATABASE_URL!, configEvents);
    console.log('[api] listening for booth config changes');
  } catch (err) {
    const delay = Math.min(30_000, 1000 * attempt);
    if (attempt === 1 || attempt % 10 === 0) {
      console.warn(`[api] LISTEN failed (retrying in ${delay} ms):`, (err as Error).message);
    }
    setTimeout(() => void startListening(attempt + 1), delay);
  }
}
void startListening();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});

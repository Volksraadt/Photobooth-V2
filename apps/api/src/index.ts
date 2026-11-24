import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { BoothConfigEvents, getDb, listenBoothConfig } from '@pb/db';
import { secretBoxFromEnv, type SecretBox } from '@pb/crypto';
import { createApp, createPaymentGateway } from './app';
import { userTokenVerifierFromEnv } from './config';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.API_PORT ?? 8787);
const configEvents = new BoothConfigEvents();
const secretBox = optionalSecretBox();
const paymentMode = process.env.PB_PAYMENT_PROVIDER === 'mock' ? 'mock' : 'midtrans';
if (paymentMode === 'mock' && process.env.NODE_ENV === 'production') {
  throw new Error('PB_PAYMENT_PROVIDER=mock is not allowed in production');
}
const app = createApp({
  db: getDb(),
  verifyUserToken: userTokenVerifierFromEnv(),
  configEvents,
  secretBox,
  payments: createPaymentGateway({ mode: paymentMode, secretBox }),
  publicApiUrl: process.env.PB_PUBLIC_API_URL?.replace(/\/$/, '') || null,
});
console.log(
  `[api] payments: ${paymentMode}${secretBox ? '' : ' (SECRET_MASTER_KEY missing: credentials cannot be saved)'}`,
);

function optionalSecretBox(): SecretBox | null {
  try {
    return secretBoxFromEnv();
  } catch (err) {
    if (process.env.NODE_ENV === 'production') throw err;
    return null;
  }
}

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

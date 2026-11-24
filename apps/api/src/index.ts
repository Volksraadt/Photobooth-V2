import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { BoothConfigEvents, getDb, listenBoothConfig, SESSION_QUEUE } from '@pb/db';
import { secretBoxFromEnv, type SecretBox } from '@pb/crypto';
import { AccessTokenCache, GoogleOAuth, googleConfigFromEnv } from '@pb/drive';
import { storageFromEnv } from '@pb/storage';
import { Queue } from 'bullmq';
import { createApp, createPaymentGateway } from './app';
import { billingGatewayFromEnv } from './billing/gateway';
import type { JobWaker } from './types';
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
const googleConfig = googleConfigFromEnv();
const billing = billingGatewayFromEnv();
const storage = storageFromEnv();
const app = createApp({
  db: getDb(),
  verifyUserToken: userTokenVerifierFromEnv(),
  configEvents,
  secretBox,
  payments: createPaymentGateway({ mode: paymentMode, secretBox }),
  publicApiUrl: process.env.PB_PUBLIC_API_URL?.replace(/\/$/, '') || null,
  storage: storage,
  google: googleConfig ? new GoogleOAuth(googleConfig) : null,
  driveTokens: new AccessTokenCache(),
  jobs: createJobWaker(),
  studioUrl: process.env.PB_STUDIO_URL ?? 'http://localhost:3000',
  billing,
  platformAdmins: (process.env.PB_PLATFORM_ADMINS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean),
});
console.log(
  `[api] drive: ${googleConfig ? 'configured' : 'not configured (set GOOGLE_CLIENT_ID/SECRET)'}, storage: ${storage.kind}, queue: ${process.env.REDIS_URL ? 'bullmq' : 'db polling'}`,
);
console.log(
  `[api] subscription billing: ${billing.mode}${billing.mode === 'disabled' ? ' (set PB_BILLING_MIDTRANS_SERVER_KEY of the PLATFORM Midtrans account)' : ` (${billing.env})`}`,
);
console.log(
  `[api] payments: ${paymentMode}${secretBox ? '' : ' (SECRET_MASTER_KEY missing: credentials cannot be saved)'}`,
);

/** Redis configured → wake the worker through BullMQ; otherwise the worker polls the job table. */
function createJobWaker(): JobWaker {
  const url = process.env.REDIS_URL;
  if (!url) return { wake: async () => undefined };
  const queue = new Queue(SESSION_QUEUE, {
    connection: { url, maxRetriesPerRequest: null },
  });
  queue.on('error', (err) => console.warn('[api] redis queue error:', err.message));
  return {
    wake: async (sessionId) => {
      await queue.add('session', { sessionId }, { removeOnComplete: 100, removeOnFail: 100 });
    },
  };
}

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

import { BoothConfigEvents, getDb, SESSION_QUEUE } from '@pb/db';
import { secretBoxFromEnv, type SecretBox } from '@pb/crypto';
import { AccessTokenCache, GoogleOAuth, googleConfigFromEnv } from '@pb/drive';
import { storageFromEnv } from '@pb/storage';
import { Queue } from 'bullmq';
import { createApp, createPaymentGateway } from './app';
import { billingGatewayFromEnv } from './billing/gateway';
import { userTokenVerifierFromEnv } from './config';
import type { JobWaker } from './types';

/**
 * The API app wired from environment variables. Shared by the long-running server (src/index.ts,
 * which also LISTENs for config changes) and the Vercel function (src/vercel.ts, serverless:
 * no LISTEN; devices fall back to polling /device/config).
 */
export function createAppFromEnv(configEvents = new BoothConfigEvents()) {
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
    storage,
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
  if (billing.mode === 'midtrans' && !process.env.PB_BILLING_MIDTRANS_SIGNATURE_KEY) {
    console.warn(
      '[api] PB_BILLING_MIDTRANS_SIGNATURE_KEY not set: /webhooks/billing only accepts notifications signed with the server key (Midtrans signs with the Signature Secret Key since 2026-10-28)',
    );
  }
  console.log(
    `[api] payments: ${paymentMode}${secretBox ? '' : ' (SECRET_MASTER_KEY missing: credentials cannot be saved)'}`,
  );
  return app;
}

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

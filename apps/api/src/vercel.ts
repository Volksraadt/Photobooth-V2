import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { keepAliveAfterResponse } from '@pb/db';
import { createAppFromEnv } from './server';

/**
 * Vercel Node function (Build Output API, see scripts/build-vercel.mjs). Serverless: no Postgres
 * LISTEN and no shared memory between instances, so config pushes and "paid" signals reach the
 * device by its polling (/device/config every few seconds, payment status checks); SSE streams
 * end at the function's max duration and the agent reconnects. Rate limits are per instance.
 * After every response the function stays alive briefly so idle DB connections close before a
 * freeze (packages/db keepAliveAfterResponse).
 */
const app = createAppFromEnv();
const listener = getRequestListener(app.fetch);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const done = keepAliveAfterResponse();
  res.once('close', done);
  return listener(req, res);
}

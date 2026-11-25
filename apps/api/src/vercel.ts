import { getRequestListener } from '@hono/node-server';
import { createAppFromEnv } from './server';

/**
 * Vercel Node function (Build Output API, see scripts/build-vercel.mjs). Serverless: no Postgres
 * LISTEN and no shared memory between instances, so config pushes and "paid" signals reach the
 * device by its polling (/device/config every few seconds, payment status checks); SSE streams
 * end at the function's max duration and the agent reconnects. Rate limits are per instance.
 */
const app = createAppFromEnv();

export default getRequestListener(app.fetch);

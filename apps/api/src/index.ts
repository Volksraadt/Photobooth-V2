import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { getDb } from '@pb/db';
import { createApp } from './app';
import { userTokenVerifierFromEnv } from './config';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.API_PORT ?? 8787);
const app = createApp({ db: getDb(), verifyUserToken: userTokenVerifierFromEnv() });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});

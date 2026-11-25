import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import type { Db } from './types';

/** Idle connection lifetime on Vercel (seconds); the functions stay alive a bit longer. */
export const SERVERLESS_IDLE_SECONDS = 2;

export function createDb(
  url: string,
  opts: { max?: number } = {},
): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, {
    // Supabase poolers cap clients per project (Free session pooler: 15), shared by Studio, API
    // and worker: lower it with PB_DB_POOL_MAX.
    max: opts.max ?? (Number(process.env.PB_DB_POOL_MAX) || 10),
    // Close idle connections (seconds) so pooler slots come back between bursts. On Vercel the
    // instance is frozen between requests: a socket kept across a freeze is dead on resume and
    // postgres.js would hang on it (Supabase KB "hanging queries in Vercel Serverless
    // Functions"). There, idle connections close after 2 s while the function is kept alive a
    // little after each response (keepAliveAfterResponse in apps/api, after() in apps/studio;
    // docs/decisions.md 2026-11-26 "Koneksi DB di Vercel").
    idle_timeout: process.env.VERCEL ? SERVERLESS_IDLE_SECONDS : 30,
    // Never reuse a connection for long on serverless (pooler may drop it silently).
    max_lifetime: process.env.VERCEL ? 60 : null,
    // Supabase transaction pooler does not support prepared statements.
    prepare: !url.includes('pooler.supabase.com'),
    onnotice: () => {},
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

const globalForDb = globalThis as unknown as { __pbDb?: Db };

/** Process-wide connection from DATABASE_URL (survives Next.js dev hot reloads). */
export function getDb(): Db {
  if (!globalForDb.__pbDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globalForDb.__pbDb = createDb(url).db;
  }
  return globalForDb.__pbDb;
}

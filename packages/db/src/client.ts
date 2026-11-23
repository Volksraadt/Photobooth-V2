import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import type { Db } from './types';

export function createDb(
  url: string,
  opts: { max?: number } = {},
): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, {
    max: opts.max ?? 10,
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

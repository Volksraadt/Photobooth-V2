import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { AUTH_SHIM_SQL } from './auth-shim';
import { MIGRATIONS_DIR } from './paths';
import * as schema from './schema';
import { createShimUser } from './seed';
import type { Db } from './types';

export { seed, seedPlans, seedTemplates } from './seed';

/** In-memory Postgres (PGlite) with the auth shim + all migrations applied. */
export async function createTestDb(): Promise<{
  db: Db;
  client: PGlite;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  await client.exec(AUTH_SHIM_SQL);
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  return { db, client, close: () => client.close() };
}

export async function createTestUser(db: Db, email: string): Promise<string> {
  return createShimUser(db, email, 'password123');
}

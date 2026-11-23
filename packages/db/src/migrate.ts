import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { AUTH_SHIM_SQL } from './auth-shim';
import { MIGRATIONS_DIR } from './paths';

/**
 * Apply the auth shim (only when the DB has no Supabase auth schema) and all migrations.
 * Must run as the database owner (postgres / Supabase direct connection).
 */
export async function runMigrations(url: string): Promise<{ appliedShim: boolean }> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [row] = await client<
      { has_auth: boolean }[]
    >`select to_regprocedure('auth.uid()') is not null as has_auth`;
    const appliedShim = !row?.has_auth;
    if (appliedShim) await client.unsafe(AUTH_SHIM_SQL);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    await db.execute(sql`select 1`);
    return { appliedShim };
  } finally {
    await client.end();
  }
}

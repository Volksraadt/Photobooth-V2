import { sql } from 'drizzle-orm';
import type { Db, Tx } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction as the Postgres role `authenticated` with auth.uid() = userId,
 * so every query is filtered by RLS. This is the only way Studio code should touch the DB.
 */
export async function withUserContext<T>(
  db: Db,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error('withUserContext: userId must be a uuid');
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`,
    );
    return fn(tx as unknown as Tx);
  });
}

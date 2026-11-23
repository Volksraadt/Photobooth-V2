import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type * as schema from './schema';

export type Schema = typeof schema;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- driver-specific HKT (postgres-js / PGlite)
export type Db = PgDatabase<any, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

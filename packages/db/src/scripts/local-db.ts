// Local Postgres for `pnpm dev` (no Docker needed). Data in packages/db/.data/pg.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { createDb } from '../client';
import { runMigrations } from '../migrate';
import { loadRootEnv, PACKAGE_DIR } from '../paths';
import { DEMO_USER, seed } from '../seed';

loadRootEnv();

const DEFAULT_URL = 'postgres://postgres:postgres@127.0.0.1:54329/photobooth';

async function main() {
  if (process.env.PB_LOCAL_DB === '0') {
    console.log('[db] PB_LOCAL_DB=0: using DATABASE_URL as-is, local Postgres not started.');
    return;
  }
  const url = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    console.log(`[db] DATABASE_URL points to ${url.hostname}; local Postgres not started.`);
    return;
  }
  const databaseDir = resolve(PACKAGE_DIR, '.data/pg');
  const dbName = url.pathname.slice(1) || 'photobooth';
  const pg = new EmbeddedPostgres({
    databaseDir,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username || 'postgres'),
    password: decodeURIComponent(url.password || 'postgres'),
    persistent: true,
    // Windows defaults to WIN1252; booth names and configs need UTF-8.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
  });

  if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) {
    console.log('[db] initialising local Postgres…');
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(dbName);
  } catch {
    // already exists
  }

  const { appliedShim } = await runMigrations(url.toString());
  const { db, close } = createDb(url.toString(), { max: 1 });
  const seeded = await seed(db);
  await close();

  console.log(`[db] ready on ${url.host}/${dbName}${appliedShim ? ' (auth shim)' : ''}`);
  if (seeded.userId) console.log(`[db] demo login: ${DEMO_USER.email} / ${DEMO_USER.password}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Postgres drops open sockets on shutdown; ignore those resets once stopping.
  process.on('uncaughtException', (err) => {
    if (stopping) return;
    console.error('[db] fatal:', err);
    process.exit(1);
  });
  setInterval(() => {}, 1 << 30);
}

main().catch((err: unknown) => {
  console.error('[db] failed to start local Postgres:', err);
  process.exit(1);
});

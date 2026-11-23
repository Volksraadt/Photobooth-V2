import { createDb } from '../client';
import { loadRootEnv } from '../paths';
import { DEMO_USER, seed } from '../seed';

loadRootEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const { db, close } = createDb(url, { max: 1 });
try {
  const result = await seed(db);
  console.log(`[db] seeded: org ${result.orgId}, booth ${result.boothId}`);
  if (result.userId) console.log(`[db] demo login: ${DEMO_USER.email} / ${DEMO_USER.password}`);
  else
    console.log('[db] Supabase auth detected: demo org has no member; add one via Studio or SQL.');
} finally {
  await close();
}

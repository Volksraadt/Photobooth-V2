import { runMigrations } from '../migrate';
import { loadRootEnv } from '../paths';

loadRootEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const { appliedShim } = await runMigrations(url);
console.log(
  `[db] migrations applied${appliedShim ? ' (auth shim installed: non-Supabase database)' : ''}`,
);

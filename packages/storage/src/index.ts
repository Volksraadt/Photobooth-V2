import { resolve } from 'node:path';
import { DiskStorage } from './disk';
import { SupabaseStorage } from './supabase';
import type { ObjectStorage } from './types';

export * from './manifest';
export * from './types';
export { DiskStorage } from './disk';
export { MemoryStorage } from './memory';
export { SupabaseStorage } from './supabase';

/**
 * `PB_STORAGE=supabase` (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, bucket
 * `PB_STORAGE_BUCKET`, default `sessions`) or `disk` (default; folder `PB_STORAGE_DIR`,
 * default `<repo>/.data/storage`). Production refuses the disk driver unless
 * PB_STORAGE_ALLOW_DISK=1.
 */
export function storageFromEnv(
  env: Record<string, string | undefined> = process.env,
): ObjectStorage {
  const mode = env.PB_STORAGE ?? (env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'disk');
  if (mode === 'supabase') {
    const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error('PB_STORAGE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    return new SupabaseStorage(
      url,
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.PB_STORAGE_BUCKET ?? 'sessions',
    );
  }
  if (mode !== 'disk') throw new Error(`PB_STORAGE must be disk or supabase (got ${mode})`);
  if (env.NODE_ENV === 'production' && env.PB_STORAGE_ALLOW_DISK !== '1') {
    throw new Error(
      'PB_STORAGE=disk is not allowed in production (set PB_STORAGE_ALLOW_DISK=1 to override)',
    );
  }
  // API and worker run from different cwds; both must share one dev folder.
  return new DiskStorage(
    env.PB_STORAGE_DIR ?? resolve(import.meta.dirname, '../../../.data/storage'),
  );
}

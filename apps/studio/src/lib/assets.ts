import type { AssetRow } from '@pb/db';
import type { AssetItem } from '@/editor/editor-context';

/** DB row → editor asset. storage_path holds the public URL (local media or Supabase). */
export function toAssetItem(row: AssetRow): AssetItem {
  return {
    id: row.id,
    kind: row.kind,
    url: row.storagePath,
    sha256: row.sha256,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    name: row.name || row.id,
  };
}

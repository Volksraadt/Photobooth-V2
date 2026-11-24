export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'failed' = 'failed',
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export interface ObjectStorage {
  readonly kind: 'disk' | 'supabase' | 'memory';
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Removes every object under `prefix/`. */
  deletePrefix(prefix: string): Promise<void>;
}

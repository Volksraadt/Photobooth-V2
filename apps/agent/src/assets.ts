import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetRef, BoothConfig } from '@pb/schema';
import { sha256Hex } from './device-api';

export class AssetDownloadError extends Error {
  constructor(
    readonly asset: AssetRef,
    reason: string,
  ) {
    super(`Aset ${asset.id} gagal diunduh: ${reason}`);
    this.name = 'AssetDownloadError';
  }
}

/** Decodes a `data:` URL (built-in assets ship inside the config). */
export function decodeDataUrl(url: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const bytes = m[3]
    ? Buffer.from(m[4]!, 'base64')
    : Buffer.from(decodeURIComponent(m[4]!), 'utf8');
  return { mime: m[1] || 'text/plain', bytes };
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
};

export function mimeFromUrl(url: string): string {
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Content-addressed asset cache: dataDir/assets/<sha256>. Every file is verified against the
 * AssetRef sha256 before it is used; a config is activated only when all its assets are present.
 */
export class AssetStore {
  readonly dir: string;
  /** sha256 values verified on disk during this run (files are immutable once written). */
  private readonly verified = new Set<string>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'assets');
    mkdirSync(this.dir, { recursive: true });
  }

  pathFor(sha256: string) {
    return join(this.dir, sha256);
  }

  has(asset: AssetRef): boolean {
    if (this.verified.has(asset.sha256)) return true;
    const path = this.pathFor(asset.sha256);
    if (!existsSync(path)) return false;
    const ok = sha256Hex(readFileSync(path)) === asset.sha256;
    if (ok) this.verified.add(asset.sha256);
    return ok;
  }

  private async download(asset: AssetRef): Promise<void> {
    let res: Response;
    try {
      res = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      throw new AssetDownloadError(asset, String(err));
    }
    if (!res.ok) throw new AssetDownloadError(asset, `HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (sha256Hex(bytes) !== asset.sha256)
      throw new AssetDownloadError(asset, 'sha256 tidak cocok');
    const path = this.pathFor(asset.sha256);
    const tmp = `${path}.part`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
    this.verified.add(asset.sha256);
  }

  /**
   * Downloads + verifies every non-data asset of a config. All-or-nothing: throws if any asset
   * fails, so the caller keeps the previous version. Returns assetId → local path.
   */
  async prepare(config: BoothConfig): Promise<Record<string, string>> {
    const paths: Record<string, string> = {};
    await Promise.all(
      config.assets.map(async (asset) => {
        if (asset.url.startsWith('data:')) return;
        if (!this.has(asset)) await this.download(asset);
        paths[asset.id] = this.pathFor(asset.sha256);
      }),
    );
    return paths;
  }

  /**
   * Bytes of a config asset for compositing: data URL, cached file, or (kiosk file mode / dev)
   * a verified download.
   */
  async load(config: BoothConfig, assetId: string): Promise<Buffer> {
    const asset = config.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Aset ${assetId} tidak ada di config`);
    const data = asset.url.startsWith('data:') ? decodeDataUrl(asset.url) : null;
    if (data) return data.bytes;
    if (!this.has(asset)) await this.download(asset);
    return readFile(this.pathFor(asset.sha256));
  }
}

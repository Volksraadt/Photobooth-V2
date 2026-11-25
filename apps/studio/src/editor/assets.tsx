'use client';

import type { AssetRef, BoothConfig } from '@pb/schema';
import { cn } from '@pb/ui';
import type { Draft } from 'immer';
import { useRef, useState } from 'react';
import { libraryAssetId, useEditor, useEnv, type AssetItem } from './editor-context';
import { Row } from './fields';

export { FONT_FAMILY_PREFIX } from '@pb/schema';

/** Adds the asset to config.assets (inside the same undo step as its first use). */
export function ensureAssetRef(d: Draft<BoothConfig>, asset: AssetItem | AssetRef) {
  if (d.assets.some((a) => a.id === asset.id)) return;
  d.assets.push({
    id: asset.id,
    kind: asset.kind,
    url: asset.url,
    sha256: asset.sha256,
    bytes: asset.bytes,
  });
}

export async function uploadAsset(file: File): Promise<AssetItem> {
  const body = new FormData();
  body.set('file', file);
  const dims = file.type.startsWith('image/') ? await imageSize(file).catch(() => null) : null;
  if (dims) {
    body.set('width', String(dims.width));
    body.set('height', String(dims.height));
  }
  const res = await fetch('/api/assets', { method: 'POST', body });
  const json = (await res.json().catch(() => ({}))) as { asset?: AssetItem; error?: string };
  if (!res.ok || !json.asset) throw new Error(json.error ?? `Upload gagal (HTTP ${res.status})`);
  return json.asset;
}

function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = reject;
    img.src = url;
  });
}

const ACCEPT: Record<AssetItem['kind'], string> = {
  image: 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif',
  video: 'video/mp4,video/webm',
  font: '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2',
  audio: 'audio/mpeg,audio/mp4,audio/ogg,audio/wav',
};

/** Library assets + assets already in the config (e.g. built-ins), of one kind. */
export function useAssetsOfKind(kind: AssetItem['kind']): AssetItem[] {
  const env = useEnv();
  const docAssets = useEditor((s) => s.doc.assets);
  const byId = new Map<string, AssetItem>();
  for (const a of docAssets) {
    if (a.kind !== kind) continue;
    const lib = env.libraryFrames.find((f) => libraryAssetId(f.id) === a.id);
    const name = lib ? `Pustaka: ${lib.name}` : a.id.startsWith('builtin-') ? 'Bawaan' : a.id;
    byId.set(a.id, { ...a, width: null, height: null, name });
  }
  for (const a of env.assets) if (a.kind === kind) byId.set(a.id, a);
  return [...byId.values()];
}

export function UploadButton({
  kind,
  onUploaded,
  label = 'Unggah',
  className,
}: {
  kind: AssetItem['kind'];
  onUploaded: (asset: AssetItem) => void;
  label?: string;
  className?: string;
}) {
  const env = useEnv();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={className}>
      <button
        type="button"
        className="h-8 rounded border border-dashed px-2 text-xs hover:bg-accent disabled:opacity-50"
        disabled={busy || !env.canEdit}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Mengunggah…' : label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPT[kind]}
        data-testid={`upload-${kind}`}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const asset = await uploadAsset(file);
            env.addAsset(asset);
            onUploaded(asset);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Pick an asset of a kind (thumbnails for images) or upload a new one. */
export function AssetField({
  label,
  kind,
  value,
  onPick,
  allowEmpty,
}: {
  label: string;
  kind: AssetItem['kind'];
  value: string | undefined;
  onPick: (asset: AssetItem | null) => void;
  allowEmpty?: boolean;
}) {
  const assets = useAssetsOfKind(kind);
  const [open, setOpen] = useState(false);
  const current = assets.find((a) => a.id === value);
  return (
    <Row label={label}>
      <div>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded border border-input bg-background px-2 text-left text-xs"
          onClick={() => setOpen((o) => !o)}
        >
          {current && kind === 'image' && (
            <img src={current.url} alt="" className="h-6 w-6 rounded object-contain bg-muted" />
          )}
          <span className="truncate">
            {current ? current.name : value ? 'Aset tidak ditemukan' : 'Pilih…'}
          </span>
        </button>
        {open && (
          <div className="mt-1 rounded border bg-background p-2 shadow-sm">
            <div className="grid max-h-48 grid-cols-3 gap-1 overflow-auto">
              {allowEmpty && (
                <button
                  type="button"
                  className="flex h-14 items-center justify-center rounded border text-[10px]"
                  onClick={() => {
                    onPick(null);
                    setOpen(false);
                  }}
                >
                  Tanpa
                </button>
              )}
              {assets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.name}
                  className={cn(
                    'flex h-14 items-center justify-center overflow-hidden rounded border bg-muted text-[10px]',
                    a.id === value && 'ring-2 ring-primary',
                  )}
                  onClick={() => {
                    onPick(a);
                    setOpen(false);
                  }}
                >
                  {kind === 'image' ? (
                    <img src={a.url} alt={a.name} className="h-full w-full object-contain" />
                  ) : (
                    <span className="truncate px-1">{a.name}</span>
                  )}
                </button>
              ))}
            </div>
            <UploadButton
              kind={kind}
              className="mt-2"
              onUploaded={(a) => {
                onPick(a);
                setOpen(false);
              }}
            />
          </div>
        )}
      </div>
    </Row>
  );
}

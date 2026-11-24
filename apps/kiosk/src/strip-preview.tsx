import { FrameComposite, RendererProvider } from '@pb/renderer';
import { migrateBoothConfig, type BoothConfig } from '@pb/schema';
import { useEffect, useState } from 'react';

export type StripPreviewData = {
  frameId: string;
  filterId: string | null;
  mirror: boolean;
  /** slotIndex → image URL. */
  photos: Record<number, string>;
  /** ISO time for {{date}}. */
  now: string;
  downloadUrl: string | null;
};

/**
 * Dev-only: the print strip exactly as the renderer draws it (Review preview / Studio editor),
 * at 1:1 strip pixels (600×1800). The F3 e2e compares it pixel by pixel with the compositor's
 * output. Data comes in the URL hash (JSON).
 */
export function StripPreview({ configUrl }: { configUrl: string }) {
  const [config, setConfig] = useState<BoothConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = JSON.parse(
    decodeURIComponent(window.location.hash.slice(1)) || '{}',
  ) as StripPreviewData;

  useEffect(() => {
    fetch(configUrl, { cache: 'no-store' })
      .then((r) => r.json())
      .then((json: unknown) => {
        const parsed = migrateBoothConfig(json);
        if (parsed.success) setConfig(parsed.config);
        else setError('config tidak valid');
      })
      .catch((e: unknown) => setError(String(e)));
  }, [configUrl]);

  if (error) return <p>{error}</p>;
  if (!config) return null;
  const frame = config.frames.find((f) => f.id === data.frameId);
  if (!frame) return <p>frame tidak ada</p>;
  const filter = config.filters.find((f) => f.id === data.filterId)?.params ?? null;
  const { width, height } = config.printProfile.stripPx;
  const shots = Object.fromEntries(
    Object.entries(data.photos).map(([k, url]) => [Number(k), { url }]),
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#ffffff' }}>
      <RendererProvider
        config={config}
        mode="live"
        runtime={{ now: new Date(data.now), downloadUrl: data.downloadUrl }}
        onAction={() => undefined}
      >
        <div
          data-testid="strip-preview"
          style={{ position: 'absolute', left: 0, top: 0, width, height, background: '#ffffff' }}
        >
          <FrameComposite
            frame={frame}
            width={width}
            height={height}
            shots={shots}
            filter={filter}
            mirror={data.mirror}
            showSlotPlaceholders={false}
          />
        </div>
      </RendererProvider>
    </div>
  );
}

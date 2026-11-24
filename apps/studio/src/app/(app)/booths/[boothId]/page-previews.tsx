'use client';

import { PageRenderer } from '@pb/renderer';
import { PAGE_TYPES, type BoothConfig, type PageType } from '@pb/schema';

const PAGE_LABEL: Record<PageType, string> = {
  cover: 'Cover',
  tutorial: 'Tutorial',
  framePick: 'Pilih Frame',
  payment: 'Pembayaran',
  capture: 'Foto',
  review: 'Review',
  processing: 'Proses',
  result: 'Hasil',
  error: 'Error',
};

/** Read-only thumbnails of every page, drawn by the same renderer the Kiosk uses. */
export function PagePreviews({ config, boothName }: { config: BoothConfig; boothName: string }) {
  const { width, height } = config.artboard;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {PAGE_TYPES.map((type) => (
        <figure key={type} data-testid={`preview-${type}`}>
          <div
            className="overflow-hidden rounded-md border"
            style={{ aspectRatio: `${width} / ${height}` }}
          >
            <PageRenderer
              page={config.pages[type]}
              config={config}
              mode="editor"
              runtime={{ boothName }}
            />
          </div>
          <figcaption className="mt-1 text-xs text-muted-foreground">{PAGE_LABEL[type]}</figcaption>
        </figure>
      ))}
    </div>
  );
}

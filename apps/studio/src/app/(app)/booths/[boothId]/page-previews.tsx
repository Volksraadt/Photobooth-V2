'use client';

import { PageRenderer } from '@pb/renderer';
import { PAGE_TYPES, type BoothConfig } from '@pb/schema';
import Link from 'next/link';
import { PAGE_LABEL } from '@/editor/labels';

/**
 * Read-only thumbnails of every page, drawn by the same renderer the Kiosk uses.
 * With `editorHref` each thumbnail opens the editor on that page.
 */
export function PagePreviews({
  config,
  boothName,
  editorHref,
}: {
  config: BoothConfig;
  boothName: string;
  editorHref?: string;
}) {
  const { width, height } = config.artboard;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {PAGE_TYPES.map((type) => {
        const thumb = (
          <>
            <div
              className="overflow-hidden rounded-md border transition group-hover:ring-2 group-hover:ring-primary"
              style={{ aspectRatio: `${width} / ${height}` }}
            >
              <PageRenderer
                page={config.pages[type]}
                config={config}
                mode="editor"
                runtime={{ boothName }}
              />
            </div>
            <figcaption className="mt-1 text-xs text-muted-foreground group-hover:text-foreground">
              {PAGE_LABEL[type]}
            </figcaption>
          </>
        );
        return (
          <figure key={type} data-testid={`preview-${type}`}>
            {editorHref ? (
              <Link
                href={`${editorHref}?page=${type}`}
                className="group block"
                aria-label={`Edit halaman ${PAGE_LABEL[type]}`}
              >
                {thumb}
              </Link>
            ) : (
              thumb
            )}
          </figure>
        );
      })}
    </div>
  );
}

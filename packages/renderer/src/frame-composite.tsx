'use client';

import type { FilterParams, Frame } from '@pb/schema';
import { ElementView } from './element-view';
import { useRenderer } from './context';
import { FilteredImage } from './filter-view';
import { fitRect } from './fit';
import type { RuntimePhoto } from './types';

export type FrameCompositeProps = {
  frame: Frame;
  /** Box the strip is fitted into (px of the parent coordinate space). */
  width: number;
  height: number;
  fit?: 'contain' | 'cover';
  /** Photo per slot index (1-based). */
  shots?: Partial<Record<number, RuntimePhoto>>;
  filter?: FilterParams | null;
  mirror?: boolean;
  /** Draw numbered gray boxes in empty slots. */
  showSlotPlaceholders?: boolean;
};

/**
 * The print strip as the compositor builds it: underlay → photos (center-cropped into slots,
 * filtered) → overlay → dynamic elements. Coordinates in strip px, scaled into the given box.
 * Must be rendered inside <PageRenderer> (or <RendererProvider>).
 */
export function FrameComposite({
  frame,
  width,
  height,
  fit = 'contain',
  shots,
  filter,
  mirror,
  showSlotPlaceholders = true,
}: FrameCompositeProps) {
  const { config, resolveAsset } = useRenderer();
  const strip = config.printProfile.stripPx;
  const rect = fitRect({ width, height }, strip, fit);
  const scale = rect.width / strip.width;
  const underlay = frame.underlayAssetId ? resolveAsset(frame.underlayAssetId) : undefined;
  const overlay = resolveAsset(frame.overlayAssetId);

  return (
    <div
      data-pb-frame-composite={frame.id}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: strip.width,
          height: strip.height,
          transformOrigin: '0 0',
          transform: `translate(${rect.x}px, ${rect.y}px) scale(${scale})`,
          overflow: 'hidden',
        }}
      >
        {underlay && <img src={underlay} alt="" draggable={false} style={layer} />}
        {frame.slots.map((slot) => {
          const photo = shots?.[slot.index];
          return (
            <div
              key={slot.index}
              data-pb-frame-slot={slot.index}
              style={{
                position: 'absolute',
                left: slot.x,
                top: slot.y,
                width: slot.width,
                height: slot.height,
                transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                borderRadius: slot.borderRadius,
                overflow: 'hidden',
                background: photo || !showSlotPlaceholders ? undefined : '#cbd5e1',
              }}
            >
              {photo ? (
                <FilteredImage src={photo.url} params={filter} mirror={mirror} fit="cover" />
              ) : (
                showSlotPlaceholders && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#64748b',
                      fontFamily: 'system-ui, sans-serif',
                      fontWeight: 700,
                      fontSize: Math.min(slot.width, slot.height) * 0.4,
                    }}
                  >
                    {slot.index}
                  </div>
                )
              )}
            </div>
          );
        })}
        {overlay && <img src={overlay} alt="" draggable={false} style={layer} />}
        {frame.dynamicElements.map((el) => (
          <ElementView key={el.id} element={el} />
        ))}
      </div>
    </div>
  );
}

const layer = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
  pointerEvents: 'none',
} as const;

'use client';

import type { BoxStyle, ElementOf } from '@pb/schema';
import type { CSSProperties, ReactNode } from 'react';
import { useRenderer } from '../context';
import { FilteredImage } from '../filter-view';
import { FrameComposite } from '../frame-composite';
import type { RuntimePhoto } from '../types';
import { Placeholder, SAMPLE_PHOTO_URL } from '../placeholder';
import { filtersOf, framesOf, selectedFilter, selectedFrame } from '../selection';
import { boxStyleToCss, textStyleToCss } from '../styles';
import { formatIdr } from '../tokens';
import { ScrollRow } from './scroll-row';

const fill = { position: 'absolute', inset: 0 } as const;

function SelectableItem({
  selected,
  itemStyle,
  selectedStyle,
  onSelect,
  testId,
  children,
  style,
}: {
  selected: boolean;
  itemStyle?: BoxStyle;
  selectedStyle: BoxStyle;
  onSelect?: () => void;
  testId: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      data-pb-item={testId}
      data-pb-selected={selected ? 'true' : 'false'}
      aria-pressed={selected}
      onClick={onSelect}
      tabIndex={onSelect ? 0 : -1}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        cursor: onSelect ? 'pointer' : 'default',
        ...boxStyleToCss(itemStyle),
        ...style,
      }}
    >
      {children}
      {selected && (
        <div style={{ ...fill, pointerEvents: 'none', ...boxStyleToCss(selectedStyle) }} />
      )}
    </button>
  );
}

export function FramePickerElementView({ el }: { el: ElementOf<'frame-picker'> }) {
  const { config, runtime, mode, onAction } = useRenderer();
  const frames = framesOf(config, runtime);
  const selectedId = mode === 'editor' ? frames[0]?.id : runtime.selectedFrameId;
  if (frames.length === 0) {
    return mode === 'editor' ? (
      <Placeholder label="Belum ada frame aktif" width={el.width} height={el.height} />
    ) : null;
  }
  const label = el.labelStyle;
  const labelHeight = label ? label.fontSize * label.lineHeight : 0;
  const labelLines = (el.showName ? 1 : 0) + (el.showPrice ? 1 : 0);
  const carousel = el.layout === 'carousel';
  const itemWidth = (el.width - el.gap * (el.columns - 1)) / el.columns;
  const rows = Math.ceil(frames.length / el.columns);
  const itemHeight = carousel || rows <= 1 ? el.height : (el.height - el.gap) / 2;
  const pad = 16;

  const thumbWidth = Math.max(1, itemWidth - pad * 2);
  const thumbHeight = Math.max(
    1,
    itemHeight - pad * 2 - (labelLines > 0 ? 8 + labelHeight * labelLines : 0),
  );
  const items = frames.map((frame) => {
    // The thumbnail is the frame design itself (underlay, sample photos, overlay, dynamic
    // elements), so owners never maintain a separate thumbnail image.
    const samples: Partial<Record<number, RuntimePhoto>> = Object.fromEntries(
      frame.slots.map((s) => [s.index, { url: SAMPLE_PHOTO_URL }]),
    );
    const price = frame.price ?? config.pricing.basePrice;
    return (
      <SelectableItem
        key={frame.id}
        testId={frame.id}
        selected={frame.id === selectedId}
        itemStyle={el.itemStyle}
        selectedStyle={el.selectedStyle}
        onSelect={
          mode === 'live' ? () => onAction({ kind: 'selectFrame', frameId: frame.id }) : undefined
        }
        style={{
          width: itemWidth,
          height: itemHeight,
          flex: 'none',
          padding: pad,
          scrollSnapAlign: 'start',
        }}
      >
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <div
            role="img"
            aria-label={frame.name}
            data-pb-frame-thumb={frame.id}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <FrameComposite
              frame={frame}
              width={thumbWidth}
              height={thumbHeight}
              fit="contain"
              shots={samples}
              showSlotPlaceholders={false}
            />
          </div>
        </div>
        {labelLines > 0 && (
          <div
            style={{
              ...textStyleToCss(label),
              marginTop: 8,
              height: labelHeight * labelLines,
              flex: 'none',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {el.showName && <div>{frame.name}</div>}
            {el.showPrice && <div style={{ fontWeight: 700 }}>{formatIdr(price)}</div>}
          </div>
        )}
      </SelectableItem>
    );
  });

  if (carousel) {
    return (
      <div data-pb-frame-picker="carousel" style={fill}>
        <ScrollRow
          testId="frames"
          interactive={mode === 'live'}
          step={itemWidth + el.gap}
          height={el.height}
          arrowColor={label?.color}
          style={{ gap: el.gap, ...boxStyleToCss(el.style) }}
        >
          {items}
        </ScrollRow>
      </div>
    );
  }
  return (
    <div
      data-pb-frame-picker
      style={{
        ...fill,
        display: 'grid',
        gridTemplateColumns: `repeat(${el.columns}, ${itemWidth}px)`,
        gridAutoRows: itemHeight,
        gap: el.gap,
        overflowX: 'hidden',
        overflowY: 'auto',
        scrollbarWidth: 'none',
        ...boxStyleToCss(el.style),
      }}
    >
      {items}
    </div>
  );
}

export function FramePreviewElementView({ el }: { el: ElementOf<'frame-preview'> }) {
  const { config, runtime, mode } = useRenderer();
  const frame = selectedFrame(config, runtime, mode);
  if (!frame) {
    return mode === 'editor' ? (
      <Placeholder label="Pratinjau frame" width={el.width} height={el.height} />
    ) : null;
  }
  const filter = selectedFilter(config, runtime);
  return (
    <div style={{ ...fill, ...boxStyleToCss(el.style), overflow: 'hidden' }}>
      <FrameComposite
        frame={frame}
        width={el.width}
        height={el.height}
        fit={el.fit}
        shots={mode === 'live' ? runtime.shots : undefined}
        filter={filter?.params}
        mirror={runtime.mirrorShots}
      />
    </div>
  );
}

export function FilterPickerElementView({ el }: { el: ElementOf<'filter-picker'> }) {
  const { config, runtime, mode, onAction, resolveAsset } = useRenderer();
  const filters = filtersOf(config, runtime);
  const selectedId =
    mode === 'editor'
      ? (filters.find((f) => f.isDefault) ?? filters[0])?.id
      : runtime.selectedFilterId;
  const firstShot = mode === 'live' ? runtime.shots?.[1]?.url : undefined;
  const label = el.labelStyle;
  const labelHeight = el.showLabel && label ? label.fontSize * label.lineHeight + 8 : 0;
  const gap = Math.round(el.itemSize * 0.12);
  const radius = el.selectedStyle.borderRadius ?? 0;

  const items = filters.map((filter) => {
    const thumb = filter.thumbnailAssetId ? resolveAsset(filter.thumbnailAssetId) : undefined;
    // Thumbnails already show the look; real/sample photos get the filter applied.
    const src = firstShot ?? thumb ?? SAMPLE_PHOTO_URL;
    const applyFilter = src !== thumb;
    return (
      <button
        key={filter.id}
        type="button"
        data-pb-item={filter.id}
        data-pb-selected={filter.id === selectedId ? 'true' : 'false'}
        aria-pressed={filter.id === selectedId}
        tabIndex={mode === 'live' ? 0 : -1}
        onClick={
          mode === 'live'
            ? () => onAction({ kind: 'selectFilter', filterId: filter.id })
            : undefined
        }
        style={{
          flex: 'none',
          width: el.itemSize,
          height: el.itemSize + labelHeight,
          display: 'flex',
          flexDirection: 'column',
          cursor: mode === 'live' ? 'pointer' : 'default',
          scrollSnapAlign: 'start',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: el.itemSize,
            height: el.itemSize,
            borderRadius: radius,
            overflow: 'hidden',
            flex: 'none',
          }}
        >
          <FilteredImage
            src={src}
            params={applyFilter ? filter.params : null}
            mirror={!!firstShot && runtime.mirrorShots}
          />
          {filter.id === selectedId && (
            <div style={{ ...fill, pointerEvents: 'none', ...boxStyleToCss(el.selectedStyle) }} />
          )}
        </div>
        {el.showLabel && (
          <div
            style={{
              ...textStyleToCss(label),
              marginTop: 8,
              width: '100%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {filter.name}
          </div>
        )}
      </button>
    );
  });

  if (el.layout === 'row') {
    return (
      <div data-pb-filter-picker="row" style={fill}>
        <ScrollRow
          testId="filters"
          interactive={mode === 'live'}
          step={el.itemSize + gap}
          height={el.height}
          arrowColor={label?.color}
          style={{ gap, alignItems: 'flex-start', ...boxStyleToCss(el.style) }}
        >
          {items}
        </ScrollRow>
      </div>
    );
  }
  return (
    <div
      data-pb-filter-picker
      style={{
        ...fill,
        display: 'flex',
        flexWrap: 'wrap',
        alignContent: 'flex-start',
        gap,
        overflowX: 'hidden',
        overflowY: 'auto',
        scrollbarWidth: 'none',
        ...boxStyleToCss(el.style),
      }}
    >
      {items}
    </div>
  );
}

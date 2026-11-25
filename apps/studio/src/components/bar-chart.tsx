'use client';

import { cn } from '@pb/ui';
import { useState } from 'react';
import { idr } from '@/lib/format';

export type Bar = { label: string; value: number; sub?: string };

/**
 * Plain HTML/CSS bar chart (no chart library): one bar per item, scaled to the largest value.
 * A readout line above the bars shows the exact numbers of the hovered or tapped bar (touch
 * screens have no hover), and the highest bar otherwise.
 */
export function BarChart({
  data,
  testId,
  money = true,
  unit,
  height = 120,
  showEvery = 1,
}: {
  data: Bar[];
  testId: string;
  money?: boolean;
  /** Suffix for non-money values, e.g. "sesi". */
  unit?: string;
  height?: number;
  /** Print every n-th label (long ranges). */
  showEvery?: number;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.findIndex((d) => d.value === max && d.value > 0);
  const shown = picked ?? (peak >= 0 ? peak : null);
  const text = (d: Bar) =>
    `${d.label}: ${money ? idr(d.value) : `${d.value}${unit ? ` ${unit}` : ''}`}${d.sub ? ` · ${d.sub}` : ''}`;

  return (
    <div data-testid={testId} role="group" aria-label={`Grafik ${testId}`}>
      <p className="mb-2 min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {shown === null ? (
          'Belum ada data pada rentang ini.'
        ) : (
          <>
            {picked === null && 'Tertinggi · '}
            <span className="font-medium text-foreground">{text(data[shown]!)}</span>
          </>
        )}
      </p>
      <div
        className="flex items-end gap-px"
        style={{ height }}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setPicked(null)}
      >
        {data.map((d, i) => (
          <button
            type="button"
            key={`${d.label}-${i}`}
            className="group flex h-full min-w-px flex-1 items-end"
            title={text(d)}
            aria-label={text(d)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setPicked(i)}
            onClick={() => setPicked(i)}
          >
            <span
              className={cn(
                'block w-full rounded-t bg-primary/80 group-hover:bg-primary',
                shown === i && 'bg-primary',
              )}
              style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }}
              data-value={d.value}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-px text-[10px] text-muted-foreground">
        {data.map((d, i) => (
          <div
            key={`${d.label}-l-${i}`}
            className="min-w-px flex-1 overflow-visible whitespace-nowrap"
          >
            {i % showEvery === 0 ? d.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

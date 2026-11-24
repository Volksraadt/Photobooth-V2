import { idr } from '@/lib/format';

export type Bar = { label: string; value: number; sub?: string };

/**
 * Plain HTML/CSS bar chart (no chart library): one bar per item, scaled to the largest value.
 * `title` of each bar carries the exact numbers for hover and screen readers.
 */
export function BarChart({
  data,
  testId,
  money = true,
  height = 120,
  showEvery = 1,
}: {
  data: Bar[];
  testId: string;
  money?: boolean;
  height?: number;
  /** Print every n-th label (long ranges). */
  showEvery?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div data-testid={testId} role="img" aria-label={`Grafik ${testId}`}>
      <div className="flex items-end gap-px" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={`${d.label}-${i}`}
            className="min-w-px flex-1 rounded-t bg-primary/80"
            style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }}
            title={`${d.label}: ${money ? idr(d.value) : d.value}${d.sub ? ` · ${d.sub}` : ''}`}
            data-value={d.value}
          />
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

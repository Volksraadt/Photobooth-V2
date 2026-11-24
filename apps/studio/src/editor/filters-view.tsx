'use client';

import { createId } from '@paralleldrive/cuid2';
import { FilteredImage, SAMPLE_PHOTO_URL } from '@pb/renderer';
import { NEUTRAL_FILTER_PARAMS, type FilterParams } from '@pb/schema';
import { cn } from '@pb/ui';
import { useState } from 'react';
import { useApply, useEditor } from './editor-context';
import { IconButton, SliderField, TextField, Toggle } from './fields';

const PARAMS: { key: keyof FilterParams; label: string; min: number; max: number; step: number }[] =
  [
    { key: 'brightness', label: 'Kecerahan', min: 0, max: 2, step: 0.01 },
    { key: 'contrast', label: 'Kontras', min: 0, max: 2, step: 0.01 },
    { key: 'saturation', label: 'Saturasi', min: 0, max: 2, step: 0.01 },
    { key: 'hueRotate', label: 'Hue', min: -180, max: 180, step: 1 },
    { key: 'warmth', label: 'Hangat', min: -1, max: 1, step: 0.01 },
    { key: 'sepia', label: 'Sepia', min: 0, max: 1, step: 0.01 },
    { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
  ];

/** Filter list + parameter editor with a live preview (same FilteredImage as Kiosk). */
export function FiltersView() {
  const apply = useApply();
  const filters = useEditor((s) => s.doc.filters);
  const [selectedId, setSelectedId] = useState<string | null>(filters[0]?.id ?? null);
  const filter = filters.find((f) => f.id === selectedId) ?? filters[0];

  const set = (label: string, fn: (f: (typeof filters)[number]) => void, key?: string) =>
    apply(
      label,
      (d) => {
        const f = d.filters.find((x) => x.id === filter!.id);
        if (f) fn(f);
      },
      key ? { coalesceKey: key } : undefined,
    );

  return (
    <div className="flex h-full overflow-hidden" data-testid="filters-view">
      <div className="w-64 shrink-0 overflow-auto border-r bg-background p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Filter</h2>
          <IconButton
            title="Tambah filter"
            testId="filter-add"
            onClick={() => {
              const id = createId();
              apply('Tambah filter', (d) => {
                d.filters.push({
                  id,
                  name: `Filter ${d.filters.length + 1}`,
                  params: { ...NEUTRAL_FILTER_PARAMS },
                  enabled: true,
                  isDefault: false,
                });
              });
              setSelectedId(id);
            }}
          >
            +
          </IconButton>
        </div>
        <ul className="space-y-1">
          {filters.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded p-1 text-left text-xs hover:bg-accent',
                  f.id === filter?.id && 'bg-accent',
                )}
              >
                <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded">
                  <FilteredImage src={SAMPLE_PHOTO_URL} params={f.params} />
                </div>
                <span
                  className={cn(
                    'flex-1 truncate',
                    !f.enabled && 'text-muted-foreground line-through',
                  )}
                >
                  {f.name}
                </span>
                {f.isDefault && (
                  <span className="rounded bg-primary/15 px-1 text-[10px]">default</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {filter && (
        <div className="flex flex-1 gap-6 overflow-auto p-6">
          <div className="w-[480px] shrink-0">
            <div
              className="relative aspect-[3/2] overflow-hidden rounded-lg shadow"
              data-testid="filter-preview"
            >
              <FilteredImage src={SAMPLE_PHOTO_URL} params={filter.params} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Pratinjau memakai definisi filter yang sama dengan Kiosk dan hasil cetak.
            </p>
          </div>
          <div className="w-80 space-y-2">
            <TextField
              label="Nama"
              value={filter.name}
              onCommit={(name) => set('Nama filter', (f) => void (f.name = name || f.name))}
            />
            <Toggle
              label="Aktif"
              value={filter.enabled}
              onCommit={(enabled) => set('Aktif filter', (f) => void (f.enabled = enabled))}
            />
            <Toggle
              label="Filter default"
              value={filter.isDefault}
              onCommit={(on) =>
                on &&
                apply('Filter default', (d) => {
                  for (const f of d.filters) f.isDefault = f.id === filter.id;
                })
              }
            />
            {PARAMS.map((p) => (
              <SliderField
                key={p.key}
                label={p.label}
                testId={`filter-${p.key}`}
                value={filter.params[p.key]}
                min={p.min}
                max={p.max}
                step={p.step}
                onCommit={(v) =>
                  set(p.label, (f) => void (f.params[p.key] = v), `filter:${filter.id}:${p.key}`)
                }
              />
            ))}
            <div className="flex gap-2 pt-2">
              <IconButton
                title="Reset"
                onClick={() =>
                  set('Reset filter', (f) => void (f.params = { ...NEUTRAL_FILTER_PARAMS }))
                }
              >
                Reset
              </IconButton>
              <IconButton
                title="Hapus filter"
                disabled={filters.length <= 1}
                onClick={() => {
                  const rest = filters.filter((f) => f.id !== filter.id);
                  apply('Hapus filter', (d) => {
                    d.filters.splice(
                      d.filters.findIndex((f) => f.id === filter.id),
                      1,
                    );
                    if (!d.filters.some((f) => f.isDefault) && d.filters[0])
                      d.filters[0].isDefault = true;
                  });
                  setSelectedId(rest[0]?.id ?? null);
                }}
              >
                Hapus
              </IconButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

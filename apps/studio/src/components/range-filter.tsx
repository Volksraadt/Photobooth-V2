'use client';

import { Button, cn } from '@pb/ui';
import Link from 'next/link';
import { useRef } from 'react';
import { addDays } from '@/lib/range';

type Option = { id: string; name: string; boothName?: string | null };

/**
 * Shared date/booth/device filter of Rekap and Transaksi. Presets show which range is active;
 * booth and device apply as soon as they change, dates with "Terapkan" (two fields, one submit).
 */
export function RangeFilter({
  basePath,
  from,
  to,
  today,
  booths,
  devices,
  boothId,
  deviceId,
  testId,
}: {
  basePath: string;
  from: string;
  to: string;
  today: string;
  booths: Option[];
  devices: Option[];
  boothId: string | null;
  deviceId: string | null;
  testId?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const presets = [
    { days: 1, label: 'Hari ini' },
    { days: 7, label: '7 hari' },
    { days: 30, label: '30 hari' },
  ].map((p) => {
    const pFrom = addDays(today, -(p.days - 1));
    const q = new URLSearchParams({ from: pFrom, to: today });
    if (boothId) q.set('booth', boothId);
    if (deviceId) q.set('device', deviceId);
    return { ...p, href: `${basePath}?${q}`, active: from === pFrom && to === today };
  });
  const custom = !presets.some((p) => p.active);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <div className="space-y-2 rounded border bg-background p-3 text-sm" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Rentang cepat">
        {presets.map((p) => (
          <Link
            key={p.days}
            href={p.href}
            aria-current={p.active ? 'true' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              p.active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {p.label}
          </Link>
        ))}
        {custom && (
          <span className="rounded-full border border-primary px-3 py-1 text-xs text-primary">
            Rentang khusus
          </span>
        )}
      </div>
      <form ref={formRef} action={basePath} className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Dari</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            max={today}
            className="h-9 rounded-md border bg-background px-2"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Sampai</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            max={today}
            className="h-9 rounded-md border bg-background px-2"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Booth</span>
          <select
            name="booth"
            defaultValue={boothId ?? ''}
            onChange={submit}
            className="h-9 max-w-[14rem] rounded-md border bg-background px-2"
          >
            <option value="">Semua booth</option>
            {booths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Perangkat</span>
          <select
            name="device"
            defaultValue={deviceId ?? ''}
            onChange={submit}
            className="h-9 max-w-[14rem] rounded-md border bg-background px-2"
          >
            <option value="">Semua perangkat</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.boothName ? ` · ${d.boothName}` : ''}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          Terapkan tanggal
        </Button>
      </form>
    </div>
  );
}

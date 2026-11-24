export const idr = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

export const METHOD_LABEL: Record<string, string> = {
  qris: 'QRIS',
  voucher: 'Voucher',
  cash: 'Tunai',
  free: 'Gratis (event)',
};

/** "25 Nov 2026 23.30" in the given zone (booth zone for sessions, never the server's). */
export function formatDateTime(d: Date | null | undefined, timeZone: string): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(d);
}

/** "25 Nov 2026" from a `YYYY-MM-DD` calendar date (no timezone shift). */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export function formatShortDay(day: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

export function agoText(from: Date | null, now: number): string {
  if (!from) return 'belum pernah';
  const s = Math.max(0, Math.round((now - from.getTime()) / 1000));
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86400)} hari lalu`;
}

/** Current time for server components (a function, so render stays free of direct impure calls). */
export const nowMs = () => Date.now();

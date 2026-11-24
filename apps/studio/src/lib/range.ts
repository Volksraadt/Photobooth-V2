/**
 * Date-range filter of the recap. Dates are booth-local calendar dates (`YYYY-MM-DD`), so "today"
 * is computed in the org's zone, never from the server's or the browser's.
 */

export const isDate = (v: string | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export type Range = { from: string; to: string; clamped: boolean; today: string };

/**
 * Defaults to the last 7 days. `maxDays` (Starter: 30) limits how far back the owner can look;
 * the range never exceeds 366 days and never ends in the future.
 */
export function resolveRange(
  input: { from?: string; to?: string },
  today: string,
  maxDays: number | null,
): Range {
  let to = isDate(input.to) ? input.to : today;
  if (to > today) to = today;
  let from = isDate(input.from) ? input.from : addDays(to, -6);
  if (from > to) from = to;
  if (from < addDays(to, -365)) from = addDays(to, -365);
  let clamped = false;
  if (maxDays) {
    const earliest = addDays(today, -(maxDays - 1));
    if (from < earliest) {
      from = earliest;
      clamped = true;
    }
    if (to < earliest) to = earliest;
  }
  return { from, to, clamped, today };
}

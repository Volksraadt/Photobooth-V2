import { createId } from '@paralleldrive/cuid2';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDays,
  getReport,
  listTransactions,
  localDate,
  refreshDailyBoothStats,
} from './report-repo';
import { createOrg } from './repo';
import { booths, devices, printJobs, sessions } from './schema';
import { createTestDb, createTestUser, seedPlans } from './testing';
import type { Db } from './types';
import { withUserContext } from './user-context';

/**
 * Acceptance F6: dashboard numbers equal a manual query on the seed data, and a 23:30 WIB session
 * lands on the right local date even though it is stored in UTC.
 */

let db: Db;
let close: () => Promise<void>;
let orgId: string;
let userId: string;
let otherUserId: string;
let wib: string; // Asia/Jakarta (UTC+7)
let wita: string; // Asia/Makassar (UTC+8)
let deviceWib: string;

type Fx = {
  code: string;
  booth: 'wib' | 'wita';
  at: string; // UTC instant
  method: 'qris' | 'voucher' | 'cash' | 'free' | null;
  gross: number;
  fee?: number;
  extra?: number;
  offline?: boolean;
  frame?: string;
  filter?: string;
  device?: boolean;
};

const FIXTURES: Fx[] = [
  // 23:30 WIB on 20 Nov (= 16:30 UTC the same day)
  {
    code: 'AAAAAAA2',
    booth: 'wib',
    at: '2026-11-20T16:30:00Z',
    method: 'qris',
    gross: 35000,
    fee: 245,
    frame: 'f-a',
    filter: 'fl-1',
    device: true,
  },
  // 00:30 WIB on 21 Nov, still 20 Nov in UTC (17:30Z)
  {
    code: 'AAAAAAA3',
    booth: 'wib',
    at: '2026-11-20T17:30:00Z',
    method: 'cash',
    gross: 35000,
    extra: 2,
    frame: 'f-a',
    filter: 'fl-2',
    offline: true,
    device: true,
  },
  // 10:00 WIB on 21 Nov
  {
    code: 'AAAAAAA4',
    booth: 'wib',
    at: '2026-11-21T03:00:00Z',
    method: 'voucher',
    gross: 50000,
    frame: 'f-b',
    filter: 'fl-1',
  },
  // 23:59 WITA on 20 Nov (= 15:59 UTC); 22:59 WIB: another booth, another zone
  {
    code: 'AAAAAAA5',
    booth: 'wita',
    at: '2026-11-20T15:59:00Z',
    method: 'qris',
    gross: 40000,
    fee: 280,
    frame: 'f-c',
    filter: 'fl-1',
  },
  // free event session: counted, zero revenue
  {
    code: 'AAAAAAA6',
    booth: 'wib',
    at: '2026-11-21T04:00:00Z',
    method: 'free',
    gross: 0,
    frame: 'f-a',
    filter: 'fl-1',
  },
  // never paid: not a sale
  { code: 'AAAAAAA7', booth: 'wib', at: '2026-11-21T05:00:00Z', method: null, gross: 0 },
  // outside the range
  {
    code: 'AAAAAAA8',
    booth: 'wib',
    at: '2026-11-25T03:00:00Z',
    method: 'qris',
    gross: 35000,
    fee: 245,
  },
];

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedPlans(db);
  userId = await createTestUser(db, 'owner@f6.test');
  otherUserId = await createTestUser(db, 'other@f6.test');
  orgId = (await withUserContext(db, userId, (tx) => createOrg(tx, { name: 'Org F6' }))).id;
  await withUserContext(db, otherUserId, (tx) => createOrg(tx, { name: 'Other F6' }));
  wib = createId();
  wita = createId();
  await db.insert(booths).values([
    { id: wib, orgId, name: 'Booth WIB', timezone: 'Asia/Jakarta' },
    { id: wita, orgId, name: 'Booth WITA', timezone: 'Asia/Makassar' },
  ]);
  deviceWib = createId();
  await db.insert(devices).values({
    id: deviceWib,
    orgId,
    boothId: wib,
    name: 'Laptop WIB',
    tokenHash: createId() + createId(),
  });
  for (const f of FIXTURES) {
    await db.insert(sessions).values({
      id: createId(),
      orgId,
      boothId: f.booth === 'wib' ? wib : wita,
      deviceId: f.device ? deviceWib : null,
      code: f.code,
      startedAt: new Date(f.at),
      status: f.method ? 'completed' : 'started',
      paymentMethod: f.method,
      grossAmount: f.gross,
      feeAmount: f.fee ?? 0,
      netAmount: f.gross - (f.fee ?? 0),
      extraPrints: f.extra ?? 0,
      offline: f.offline ?? false,
      frameId: f.frame ?? null,
      filterId: f.filter ?? null,
    });
  }
  await db.insert(printJobs).values([
    // 23:40 WIB 20 Nov
    {
      orgId,
      deviceId: deviceWib,
      sheets: 1,
      status: 'done',
      occurredAt: new Date('2026-11-20T16:40:00Z'),
    },
    // 01:00 WIB 21 Nov
    {
      orgId,
      deviceId: deviceWib,
      sheets: 3,
      status: 'done',
      occurredAt: new Date('2026-11-20T18:00:00Z'),
    },
    {
      orgId,
      deviceId: deviceWib,
      sheets: 9,
      status: 'failed',
      occurredAt: new Date('2026-11-20T18:10:00Z'),
    },
  ]);
}, 60_000);

afterAll(async () => {
  await close();
});

/** The "manual query": plain SQL over the raw rows, grouped by the booth-local date. */
async function manual(from: string, to: string, filter?: (f: Fx) => boolean) {
  const zone = { wib: 'Asia/Jakarta', wita: 'Asia/Makassar' } as const;
  const rows = FIXTURES.filter((f) => f.method !== null && (!filter || filter(f))).filter((f) => {
    const d = localDate(new Date(f.at), zone[f.booth]);
    return d >= from && d <= to;
  });
  return {
    sessions: rows.length,
    gross: rows.reduce((a, r) => a + r.gross, 0),
    fee: rows.reduce((a, r) => a + (r.fee ?? 0), 0),
    perDay: rows.reduce<Record<string, number>>((acc, r) => {
      const d = localDate(new Date(r.at), zone[r.booth]);
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

const range = { from: '2026-11-20', to: '2026-11-21' };
const today = new Date('2026-11-30T05:00:00Z'); // all fixture days are "finished days" → from the view

describe('daily_booth_stats (materialized view)', () => {
  it('is empty until refreshed (finished days are read from the view)', async () => {
    const r = await getReport(db, { orgId, ...range, asOf: today });
    expect(r.totals.sessions).toBe(0);
  });

  it('after a refresh the dashboard equals the manual query', async () => {
    await refreshDailyBoothStats(db);
    const m = await manual(range.from, range.to);
    const r = await getReport(db, { orgId, ...range, asOf: today });
    expect(r.totals.sessions).toBe(m.sessions);
    expect(r.totals.gross).toBe(m.gross);
    expect(r.totals.fee).toBe(m.fee);
    expect(r.totals.net).toBe(m.gross - m.fee);
    expect(r.totals.averageGross).toBe(Math.round(m.gross / m.sessions));
    expect(r.totals.extraPrints).toBe(2);
    expect(r.totals.offlineSessions).toBe(1);
    // 5 sold sessions: 35.000 + 35.000 + 50.000 + 40.000 + 0
    expect(r.totals).toMatchObject({ sessions: 5, gross: 160000, fee: 525, net: 159475 });
    // A raw SQL sum agrees too.
    const rows = (await db.execute(sql`
      select count(*)::int as n, sum(gross_amount)::int as g from sessions
      where payment_method is not null and started_at >= '2026-11-20T00:00:00Z' and started_at < '2026-11-22T00:00:00Z'`)) as unknown;
    const raw = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows)[0] as {
      n: number;
      g: number;
    };
    expect(r.totals.sessions).toBe(raw.n);
    expect(r.totals.gross).toBe(raw.g);
  });

  it('a 23:30 WIB session is on the WIB date, not the UTC date', async () => {
    const r = await getReport(db, { orgId, ...range, boothId: wib, asOf: today });
    const day = (d: string) => r.days.find((x) => x.day === d)!;
    // 16:30Z on 20 Nov is 23:30 WIB on 20 Nov; 17:30Z is 00:30 WIB on 21 Nov (UTC says 20 Nov).
    expect(day('2026-11-20')).toMatchObject({ sessions: 1, gross: 35000 });
    expect(day('2026-11-21')).toMatchObject({ sessions: 3, gross: 85000 }); // cash 00:30, voucher, free
    // The hourly chart uses the booth hour too.
    expect(r.hours[23]).toMatchObject({ sessions: 1, gross: 35000 });
    expect(r.hours[0]).toMatchObject({ sessions: 1, gross: 35000 });
    expect(r.hours[10]).toMatchObject({ sessions: 1, gross: 50000 });
  });

  it('each booth uses its own timezone', async () => {
    // 15:59Z = 23:59 WITA on 20 Nov, but 22:59 WIB: still 20 Nov in both, so choose a boundary day.
    const r = await getReport(db, {
      orgId,
      from: '2026-11-20',
      to: '2026-11-20',
      boothId: wita,
      asOf: today,
    });
    expect(r.totals).toMatchObject({ sessions: 1, gross: 40000 });
    const next = await getReport(db, {
      orgId,
      from: '2026-11-21',
      to: '2026-11-21',
      boothId: wita,
      asOf: today,
    });
    expect(next.totals.sessions).toBe(0);
  });

  it('breaks down methods, booths, frames, filters, print sheets and zero days', async () => {
    const r = await getReport(db, { orgId, from: '2026-11-19', to: '2026-11-22', asOf: today });
    expect(r.days.map((d) => d.day)).toEqual([
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    expect(r.days[0]).toMatchObject({ sessions: 0, gross: 0 });
    const m = Object.fromEntries(r.methods.map((x) => [x.method, x]));
    expect(m.qris).toMatchObject({ sessions: 2, gross: 75000 });
    expect(m.cash).toMatchObject({ sessions: 1, gross: 35000 });
    expect(m.voucher).toMatchObject({ sessions: 1, gross: 50000 });
    expect(m.free).toMatchObject({ sessions: 1, gross: 0 });
    expect(r.booths.map((b) => [b.name, b.sessions, b.gross])).toEqual([
      ['Booth WIB', 4, 120000],
      ['Booth WITA', 1, 40000],
    ]);
    expect(r.frames[0]).toMatchObject({ frameId: 'f-a', sessions: 3, gross: 70000 });
    expect(r.filters[0]).toMatchObject({ filterId: 'fl-1', sessions: 4 });
    // 1 + 3 done sheets; the failed job is not counted
    expect(r.totals.printedSheets).toBe(4);
  });

  it('filters by device (always live)', async () => {
    const r = await getReport(db, { orgId, ...range, deviceId: deviceWib, asOf: today });
    expect(r.totals).toMatchObject({ sessions: 2, gross: 70000 });
    expect(r.totals.printedSheets).toBe(4);
  });

  it('today (booth-local) is read live, finished days from the view', async () => {
    // As of 21 Nov 12:00 WIB the 21 Nov sessions are "today": counted live even though the view
    // was refreshed before... and a session inserted after the refresh shows up immediately.
    await db.insert(sessions).values({
      id: createId(),
      orgId,
      boothId: wib,
      code: 'AAAAAAA9',
      startedAt: new Date('2026-11-21T04:30:00Z'),
      status: 'completed',
      paymentMethod: 'qris',
      grossAmount: 10000,
      feeAmount: 70,
      netAmount: 9930,
    });
    const asOf = new Date('2026-11-21T05:00:00Z'); // 12:00 WIB 21 Nov
    const live = await getReport(db, {
      orgId,
      from: '2026-11-21',
      to: '2026-11-21',
      boothId: wib,
      asOf,
    });
    expect(live.totals.sessions).toBe(4); // cash, voucher, free + the new one
    const stale = await getReport(db, {
      orgId,
      from: '2026-11-21',
      to: '2026-11-21',
      boothId: wib,
      asOf: today,
    });
    expect(stale.totals.sessions).toBe(3); // finished day: view not refreshed yet
    await refreshDailyBoothStats(db);
    const fresh = await getReport(db, {
      orgId,
      from: '2026-11-21',
      to: '2026-11-21',
      boothId: wib,
      asOf: today,
    });
    expect(fresh.totals.sessions).toBe(4);
    await db.delete(sessions).where(eq(sessions.code, 'AAAAAAA9'));
    await refreshDailyBoothStats(db);
  });
});

describe('isolation and listing', () => {
  it('another org sees nothing, through the view and the tables (RLS)', async () => {
    const r = await withUserContext(db, otherUserId, (tx) =>
      getReport(tx, { orgId, ...range, asOf: today }),
    );
    expect(r.totals.sessions).toBe(0);
    const t = await withUserContext(db, otherUserId, (tx) =>
      listTransactions(tx, { orgId, ...range }),
    );
    expect(t.total).toBe(0);
    // Direct access to the materialized view itself is closed to Studio users.
    await expect(
      withUserContext(db, userId, (tx) => tx.execute(sql`select * from daily_booth_stats`)),
    ).rejects.toThrow();
  });

  it('the owner reads the view through RLS', async () => {
    const r = await withUserContext(db, userId, (tx) =>
      getReport(tx, { orgId, ...range, asOf: today }),
    );
    expect(r.totals.sessions).toBe(5);
  });

  it('lists transactions with their booth-local range, newest first', async () => {
    const t = await listTransactions(db, {
      orgId,
      from: '2026-11-21',
      to: '2026-11-21',
      boothId: wib,
    });
    // 00:30 cash, 10:00 voucher, 11:00 free, 12:00 never paid
    expect(t.total).toBe(4);
    expect(t.rows.map((r) => r.code)).toEqual(['AAAAAAA7', 'AAAAAAA6', 'AAAAAAA4', 'AAAAAAA3']);
    expect(t.rows[3]).toMatchObject({
      offline: true,
      paymentMethod: 'cash',
      deviceName: 'Laptop WIB',
    });
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});

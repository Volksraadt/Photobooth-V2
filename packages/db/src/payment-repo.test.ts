import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertVouchers, listBoothVouchers, listRefundCandidates } from './payment-repo';
import { createBooth, createOrg } from './repo';
import { paymentCredentials, payments, sessions } from './schema';
import { createTestDb, createTestUser, seedPlans } from './testing';
import type { Db } from './types';
import { withUserContext } from './user-context';

let db: Db;
let close: () => Promise<void>;
let owner: string;
let stranger: string;
let orgId: string;
let boothId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedPlans(db);
  owner = await createTestUser(db, 'owner@repo.test');
  stranger = await createTestUser(db, 'stranger@repo.test');
  orgId = (await withUserContext(db, owner, (tx) => createOrg(tx, { name: 'Org' }))).id;
  boothId = (
    await withUserContext(db, owner, (tx) => createBooth(tx, { orgId, name: 'B', userId: owner }))
  ).id;
  await withUserContext(db, stranger, (tx) => createOrg(tx, { name: 'Other' }));
}, 60_000);

afterAll(async () => close());

describe('payment repo through RLS (Studio)', () => {
  it('owner creates vouchers; a stranger sees none', async () => {
    await withUserContext(db, owner, (tx) =>
      insertVouchers(tx, {
        orgId,
        boothId,
        batchId: 'b1',
        note: 'promo',
        valueType: 'amount',
        value: 25000,
        expiresAt: null,
        codes: [{ codeHash: 'a'.repeat(64), last4: '1234' }],
        userId: owner,
      }),
    );
    expect(await withUserContext(db, owner, (tx) => listBoothVouchers(tx, boothId))).toHaveLength(
      1,
    );
    expect(
      await withUserContext(db, stranger, (tx) => listBoothVouchers(tx, boothId)),
    ).toHaveLength(0);
    await expect(
      withUserContext(db, stranger, (tx) =>
        insertVouchers(tx, {
          orgId,
          boothId,
          batchId: 'x',
          note: null,
          valueType: 'full',
          value: 0,
          expiresAt: null,
          codes: [{ codeHash: 'b'.repeat(64), last4: '0000' }],
          userId: stranger,
        }),
      ),
    ).rejects.toThrow();
  });

  it('fee for Midtrans QRIS is seeded as data', async () => {
    const rows = await db.execute(
      sql`select percent from fee_settings where provider = 'midtrans' and method = 'qris'`,
    );
    expect(JSON.stringify(rows)).toContain('0.7');
  });

  it('payment credentials stay closed to Studio users', async () => {
    await db.insert(paymentCredentials).values({
      orgId,
      provider: 'midtrans',
      env: 'sandbox',
      encryptedSecret: 'v1.x',
      isActive: true,
    });
    const seen = await withUserContext(db, owner, (tx) => tx.select().from(paymentCredentials));
    expect(seen).toHaveLength(0);
    expect(await withUserContext(db, owner, (tx) => listRefundCandidates(tx, orgId))).toEqual([]);
  });

  it('a paid session that never completes becomes a follow-up candidate (audit T2)', async () => {
    const paidAt = new Date('2026-11-25T10:00:00Z');
    await db.insert(sessions).values({
      id: 'stuck-session',
      orgId,
      boothId,
      code: 'STUCK234',
      startedAt: paidAt,
      status: 'paid',
      paymentMethod: 'qris',
    });
    await db.insert(payments).values({
      id: 'stuckpay0000000001',
      orgId,
      sessionId: 'stuck-session',
      provider: 'midtrans',
      orderId: 'stuckpay0000000001',
      amount: 35000,
      status: 'paid',
      paidAt,
    });
    const list = (now: Date) =>
      withUserContext(db, owner, (tx) => listRefundCandidates(tx, orgId, now));

    expect(await list(new Date('2026-11-25T10:10:00Z'))).toEqual([]); // still within 30 min
    expect(await list(new Date('2026-11-25T10:31:00Z'))).toMatchObject([
      { sessionCode: 'STUCK234', reason: 'incomplete', amount: 35000 },
    ]);
    // The booth syncs the session as completed later: no longer a candidate.
    await db.update(sessions).set({ status: 'completed' }).where(eq(sessions.id, 'stuck-session'));
    expect(await list(new Date('2026-11-25T10:31:00Z'))).toEqual([]);
    // Strangers never see it.
    expect(await withUserContext(db, stranger, (tx) => listRefundCandidates(tx, orgId))).toEqual(
      [],
    );
  });
});

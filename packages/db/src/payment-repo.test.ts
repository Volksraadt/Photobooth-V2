import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertVouchers, listBoothVouchers, listRefundCandidates } from './payment-repo';
import { createBooth, createOrg } from './repo';
import { paymentCredentials } from './schema';
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
});

import { validateBoothConfig } from '@pb/schema';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  boothDrafts,
  booths,
  createBooth,
  createOrg,
  getBooth,
  listBooths,
  listMyOrgs,
  orgMembers,
  paymentCredentials,
  plans,
  subscriptions,
  withUserContext,
  type Db,
} from './index';
import { seed, seedPlans } from './seed';
import { createTestDb, createTestUser } from './testing';

let db: Db;
let close: () => Promise<void>;
let userA: string;
let userB: string;
let orgA: string;
let orgB: string;
let boothA: string;
let boothB: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedPlans(db);
  userA = await createTestUser(db, 'a@example.com');
  userB = await createTestUser(db, 'b@example.com');
  orgA = (await withUserContext(db, userA, (tx) => createOrg(tx, { name: 'Studio A' }))).id;
  orgB = (await withUserContext(db, userB, (tx) => createOrg(tx, { name: 'Studio B' }))).id;
  boothA = (
    await withUserContext(db, userA, (tx) =>
      createBooth(tx, { orgId: orgA, name: 'Booth A', userId: userA }),
    )
  ).id;
  boothB = (
    await withUserContext(db, userB, (tx) =>
      createBooth(tx, { orgId: orgB, name: 'Booth B', userId: userB }),
    )
  ).id;
}, 60_000);

afterAll(async () => {
  await close();
});

const asA = <T>(fn: Parameters<typeof withUserContext<T>>[2]) => withUserContext(db, userA, fn);

describe('signup → org → booth', () => {
  it('creates the org with the caller as owner and a trial subscription', async () => {
    const mine = await asA((tx) => listMyOrgs(tx));
    expect(mine).toEqual([expect.objectContaining({ id: orgA, name: 'Studio A', role: 'owner' })]);
    const subs = await asA((tx) => tx.select().from(subscriptions));
    expect(subs).toHaveLength(1);
    expect(subs[0]!.status).toBe('trialing');
  });

  it('stores the booth with a valid default draft config', async () => {
    const row = await asA((tx) => getBooth(tx, boothA));
    expect(row?.booth.name).toBe('Booth A');
    expect(row?.draft?.config.boothId).toBe(boothA);
    expect(validateBoothConfig(row?.draft?.config).success).toBe(true);
  });

  it('rejects create_org without an authenticated user', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('role', 'authenticated', true)`);
        await tx.execute(sql`select app.create_org('x', 'y', 'z', 'Nope', 'nope', 'Asia/Jakarta')`);
      }),
    ).rejects.toThrow();
  });
});

describe('RLS isolation between orgs', () => {
  it('user A cannot read booths of org B', async () => {
    expect(await asA((tx) => listBooths(tx, orgB))).toEqual([]);
    expect(await asA((tx) => getBooth(tx, boothB))).toBeNull();
    const all = await asA((tx) => tx.select({ id: booths.id }).from(booths));
    expect(all.map((b) => b.id)).toEqual([boothA]);
  });

  it('user A cannot read drafts, members or the org row of org B', async () => {
    const drafts = await asA((tx) => tx.select({ boothId: boothDrafts.boothId }).from(boothDrafts));
    expect(drafts.map((d) => d.boothId)).toEqual([boothA]);
    const members = await asA((tx) => tx.select({ orgId: orgMembers.orgId }).from(orgMembers));
    expect(new Set(members.map((m) => m.orgId))).toEqual(new Set([orgA]));
    expect((await asA((tx) => listMyOrgs(tx))).map((o) => o.id)).toEqual([orgA]);
  });

  it('user A cannot create a booth in org B', async () => {
    await expect(
      asA((tx) => createBooth(tx, { orgId: orgB, name: 'Intrusion', userId: userA })),
    ).rejects.toThrow();
  });

  it('user A cannot update or delete booths of org B', async () => {
    const updated = await asA((tx) =>
      tx
        .update(booths)
        .set({ name: 'hacked' })
        .where(eq(booths.id, boothB))
        .returning({ id: booths.id }),
    );
    expect(updated).toEqual([]);
    const deleted = await asA((tx) =>
      tx.delete(booths).where(eq(booths.id, boothB)).returning({ id: booths.id }),
    );
    expect(deleted).toEqual([]);
    const [still] = await db
      .select({ name: booths.name })
      .from(booths)
      .where(eq(booths.id, boothB));
    expect(still?.name).toBe('Booth B');
  });

  it('user A cannot add themselves to org B', async () => {
    await expect(
      asA((tx) => tx.insert(orgMembers).values({ orgId: orgB, userId: userA, role: 'owner' })),
    ).rejects.toThrow();
  });

  it('child rows cannot point at a parent in another org (tenant FK)', async () => {
    await expect(
      db.insert(boothDrafts).values({ orgId: orgA, boothId: boothB, config: {} as never }),
    ).rejects.toThrow();
  });
});

describe('roles and closed tables', () => {
  it('operators can read booths but not create them', async () => {
    const op = await createTestUser(db, 'op@example.com');
    await db.insert(orgMembers).values({ orgId: orgA, userId: op, role: 'operator' });
    const seen = await withUserContext(db, op, (tx) => listBooths(tx, orgA));
    expect(seen.map((b) => b.id)).toEqual([boothA]);
    await expect(
      withUserContext(db, op, (tx) => createBooth(tx, { orgId: orgA, name: 'Nope', userId: op })),
    ).rejects.toThrow();
  });

  it('payment credentials are invisible to Studio users, even owners', async () => {
    await db.insert(paymentCredentials).values({
      orgId: orgA,
      provider: 'midtrans',
      env: 'sandbox',
      encryptedSecret: 'v1.x.y.z.w',
    });
    expect(await asA((tx) => tx.select().from(paymentCredentials))).toEqual([]);
  });

  it('plans are readable by any signed-in user', async () => {
    const rows = await asA((tx) => tx.select({ code: plans.code }).from(plans));
    expect(rows.map((r) => r.code).sort()).toEqual(['business', 'pro', 'starter']);
  });

  it('audit log is append-only for everyone', async () => {
    await asA((tx) =>
      tx.insert(auditLogs).values({
        orgId: orgA,
        actorId: userA,
        action: 'booth.create',
        entity: 'booth',
        entityId: boothA,
      }),
    );
    // Drizzle wraps driver errors; the Postgres message is on `cause`.
    const appendOnly = { cause: expect.objectContaining({ message: 'audit_logs is append-only' }) };
    await expect(db.update(auditLogs).set({ action: 'x' })).rejects.toMatchObject(appendOnly);
    await expect(db.delete(auditLogs)).rejects.toMatchObject(appendOnly);
  });

  it('members cannot write audit entries as someone else', async () => {
    await expect(
      asA((tx) =>
        tx.insert(auditLogs).values({ orgId: orgA, actorId: userB, action: 'x', entity: 'y' }),
      ),
    ).rejects.toThrow();
  });

  it('withUserContext rejects non-uuid user ids', async () => {
    await expect(withUserContext(db, "x' or 1=1", async () => 1)).rejects.toThrow(/uuid/);
  });
});

describe('seed', () => {
  it('creates 3 plans, a demo org and a demo booth with an active published config, idempotently', async () => {
    const first = await seed(db);
    const second = await seed(db);
    expect(second.orgId).toBe(first.orgId);
    expect(second.boothId).toBe(first.boothId);
    expect(first.userId).toBeTruthy();
    const rows = await withUserContext(db, first.userId!, (tx) => listBooths(tx, first.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.activeConfigId).toBeTruthy();
  });
});

import {
  adminDeleteLibraryFrame,
  adminInsertLibraryFrame,
  adminListLibraryFrames,
  adminListOrgs,
  adminSetSubscription,
  BillingError,
  listPlans,
  runBillingLifecycle,
  setPlanPrice,
  adminUpdateLibraryFrame,
  type LibraryFrameRow,
} from '@pb/db';
import { assetUrlPrefixesFromEnv, isAllowedAssetUrl, PhotoSlotSchema } from '@pb/schema';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { userAuth } from '../middleware/user-auth';
import type { AppEnv } from '../types';

/** Platform admins are named by e-mail in PB_PLATFORM_ADMINS (comma separated). */
export const requirePlatformAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const email = c.var.user.email?.toLowerCase();
  if (!email || !c.var.deps.platformAdmins.includes(email))
    return c.json({ error: 'forbidden', message: 'Hanya admin platform.' }, 403);
  await next();
});

const SubscriptionBody = z.object({
  planCode: z.enum(['starter', 'pro', 'business']),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled']),
  periodDays: z.number().int().min(0).max(3650).optional(),
  note: z.string().max(300).optional(),
});
const Slots = z
  .array(PhotoSlotSchema)
  .min(1)
  .max(12)
  .refine((s) => s.every((slot, i) => slot.index === i + 1), 'Urutan slot harus 1..n.');
const LibraryFrameBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).nullable().optional(),
  url: z.string().url().max(2000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z
    .number()
    .int()
    .positive()
    .max(15 * 1024 * 1024),
  mimeType: z.enum(['image/png', 'image/webp', 'image/svg+xml']),
  width: z.number().int().positive().max(20_000).nullable().optional(),
  height: z.number().int().positive().max(20_000).nullable().optional(),
  slots: Slots,
  sortOrder: z.number().int().min(-100_000).max(100_000).optional(),
  isPublished: z.boolean().optional(),
});
const LibraryFramePatch = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(300).nullable(),
    slots: Slots,
    sortOrder: z.number().int().min(-100_000).max(100_000),
    isPublished: z.boolean(),
  })
  .partial();

const libraryFrameJson = (r: LibraryFrameRow) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const PriceBody = z.object({ priceMonthly: z.number().int().min(0).max(100_000_000).nullable() });

/**
 * Cross-org operations for the platform team. The only endpoints that read or change more than
 * one org; every change is written to that org's audit log with the admin as actor.
 */
export function adminRoutes() {
  const app = new Hono<AppEnv>();
  app.use('*', userAuth);
  app.use('*', requirePlatformAdmin);

  app.get('/me', (c) => c.json({ admin: true, email: c.var.user.email }));

  app.get('/orgs', async (c) => {
    const { db } = c.var.deps;
    const [orgs, plans] = await Promise.all([adminListOrgs(db), listPlans(db)]);
    return c.json({
      orgs: orgs.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
        periodEnd: o.periodEnd?.toISOString() ?? null,
        graceUntil: o.graceUntil?.toISOString() ?? null,
      })),
      plans: plans.map((p) => ({ code: p.code, name: p.name, priceMonthly: p.priceMonthly })),
    });
  });

  app.put('/orgs/:orgId/subscription', async (c) => {
    const body = SubscriptionBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', message: 'Data tidak valid.' }, 400);
    try {
      await adminSetSubscription(c.var.deps.db, {
        orgId: c.req.param('orgId'),
        ...body.data,
        actorId: c.var.user.userId,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof BillingError)
        return c.json({ error: err.code, message: err.message }, 400);
      throw err;
    }
  });

  app.put('/plans/:code/price', async (c) => {
    const body = PriceBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', message: 'Harga tidak valid.' }, 400);
    try {
      await setPlanPrice(c.var.deps.db, {
        code: c.req.param('code'),
        priceMonthly: body.data.priceMonthly,
        actorId: c.var.user.userId,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof BillingError)
        return c.json({ error: err.code, message: err.message }, 400);
      throw err;
    }
  });

  // --- Platform frame library (owners read it through RLS in Studio) ---------------------------

  app.get('/library-frames', async (c) => {
    const rows = await adminListLibraryFrames(c.var.deps.db);
    return c.json({ frames: rows.map(libraryFrameJson) });
  });

  app.post('/library-frames', async (c) => {
    const body = LibraryFrameBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: 'invalid_body', message: 'Data frame tidak valid.' }, 400);
    // Same rule as booth configs: only files in the platform's own storage (T1).
    if (!isAllowedAssetUrl(body.data.url, assetUrlPrefixesFromEnv(process.env)))
      return c.json(
        { error: 'invalid_url', message: 'File frame harus dari penyimpanan platform.' },
        400,
      );
    const row = await adminInsertLibraryFrame(c.var.deps.db, {
      ...body.data,
      createdBy: c.var.user.userId,
    });
    return c.json({ frame: libraryFrameJson(row) }, 201);
  });

  app.patch('/library-frames/:id', async (c) => {
    const body = LibraryFramePatch.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: 'invalid_body', message: 'Data frame tidak valid.' }, 400);
    const row = await adminUpdateLibraryFrame(c.var.deps.db, c.req.param('id'), body.data);
    if (!row) return c.json({ error: 'not_found', message: 'Frame tidak ditemukan.' }, 404);
    return c.json({ frame: libraryFrameJson(row) });
  });

  app.delete('/library-frames/:id', async (c) => {
    const ok = await adminDeleteLibraryFrame(c.var.deps.db, c.req.param('id'));
    if (!ok) return c.json({ error: 'not_found', message: 'Frame tidak ditemukan.' }, 404);
    return c.json({ ok: true });
  });

  /** Runs the same job the worker runs every hour (support / tests). */
  app.post('/billing/run-lifecycle', async (c) => {
    return c.json(await runBillingLifecycle(c.var.deps.db));
  });

  return app;
}

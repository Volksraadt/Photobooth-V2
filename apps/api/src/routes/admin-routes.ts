import {
  adminListOrgs,
  adminSetSubscription,
  BillingError,
  listPlans,
  runBillingLifecycle,
  setPlanPrice,
} from '@pb/db';
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

  /** Runs the same job the worker runs every hour (support / tests). */
  app.post('/billing/run-lifecycle', async (c) => {
    return c.json(await runBillingLifecycle(c.var.deps.db));
  });

  return app;
}

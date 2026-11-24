import {
  booths,
  claimPairingCode,
  listMyOrgs,
  PairingError,
  PlanLimitError,
  withUserContext,
} from '@pb/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { userAuth } from '../middleware/user-auth';
import type { AppEnv } from '../types';

const ClaimBody = z.object({
  code: z.string().regex(/^\d{6}$/),
  boothId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
});

/** Studio-facing API (sensitive actions). User token; access decided with RLS. */
export function studioRoutes() {
  const app = new Hono<AppEnv>();
  app.use('*', userAuth);

  app.get('/me', async (c) => {
    const user = c.var.user;
    const orgs = await withUserContext(c.var.deps.db, user.userId, (tx) => listMyOrgs(tx));
    return c.json({ user: { id: user.userId, email: user.email }, orgs });
  });

  /** Owner/manager pairs a kiosk to a booth with the 6-digit code shown on it. */
  app.post('/pairing/claim', async (c) => {
    const body = ClaimBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', message: 'Data tidak valid.' }, 400);
    const { db } = c.var.deps;
    const userId = c.var.user.userId;
    // RLS decides visibility; the role check decides who may add devices.
    const access = await withUserContext(db, userId, async (tx) => {
      const [booth] = await tx
        .select({ id: booths.id, orgId: booths.orgId })
        .from(booths)
        .where(eq(booths.id, body.data.boothId));
      if (!booth) return null;
      const org = (await listMyOrgs(tx)).find((o) => o.id === booth.orgId);
      return org ? { booth, role: org.role } : null;
    });
    if (!access) return c.json({ error: 'not_found', message: 'Booth tidak ditemukan.' }, 404);
    if (access.role === 'operator') {
      return c.json(
        { error: 'forbidden', message: 'Operator tidak dapat memasang perangkat.' },
        403,
      );
    }
    try {
      const { deviceId } = await claimPairingCode(db, {
        code: body.data.code,
        boothId: access.booth.id,
        orgId: access.booth.orgId,
        name: body.data.name,
        userId,
      });
      return c.json({ deviceId }, 201);
    } catch (err) {
      if (err instanceof PairingError) {
        return c.json({ error: `pairing_${err.code}`, message: err.message }, 400);
      }
      if (err instanceof PlanLimitError) {
        return c.json(
          {
            error: 'plan_limit',
            message: `Paket ${err.planName} hanya mengizinkan ${err.max} perangkat per booth. Upgrade paket untuk menambah perangkat.`,
          },
          402,
        );
      }
      throw err;
    }
  });

  return app;
}

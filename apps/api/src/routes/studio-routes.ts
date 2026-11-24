import {
  booths,
  claimPairingCode,
  getCredential,
  listCredentials,
  listMyOrgs,
  PairingError,
  PaymentRepoError,
  PlanLimitError,
  recordCredentialTest,
  saveCredential,
  withUserContext,
  type CredentialRow,
} from '@pb/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireOrgEditor } from '../middleware/org-access';
import { studioDriveRoutes } from './drive-routes';
import { userAuth } from '../middleware/user-auth';
import { encryptCredential } from '../payments/gateway';
import type { AppEnv } from '../types';
import { webhookUrl } from './payment-routes';

const ClaimBody = z.object({
  code: z.string().regex(/^\d{6}$/),
  boothId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
});

/** Studio-facing API (sensitive actions). User token; access decided with RLS. */
export function studioRoutes() {
  const app = new Hono<AppEnv>();
  app.use('*', userAuth);
  app.route('/', studioDriveRoutes());

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

  // --- Midtrans integration (credentials are write-only from Studio's point of view) ---

  const credentialView = (r: CredentialRow) => ({
    env: r.env,
    merchantId: r.merchantId,
    clientKey: r.clientKey,
    isActive: r.isActive,
    status: r.status,
    lastTestedAt: r.lastTestedAt?.toISOString() ?? null,
    lastTestMessage: r.lastTestMessage,
    hasServerKey: true,
  });

  app.get('/orgs/:orgId/integrations/midtrans', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const rows = await listCredentials(c.var.deps.db, orgId);
    return c.json({
      mode: c.var.deps.payments.mode,
      encryptionReady: !!c.var.deps.secretBox,
      webhookUrl: webhookUrl(c.var.deps, orgId),
      credentials: rows.filter((r) => r.provider === 'midtrans').map(credentialView),
    });
  });

  app.put('/orgs/:orgId/integrations/midtrans', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const body = MidtransBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', message: 'Data tidak valid.' }, 400);
    const box = c.var.deps.secretBox;
    if (!box) {
      return c.json(
        {
          error: 'encryption_unavailable',
          message: 'SECRET_MASTER_KEY belum diatur di server API.',
        },
        503,
      );
    }
    const { env, serverKey, clientKey, merchantId, active } = body.data;
    try {
      const saved = await saveCredential(c.var.deps.db, {
        orgId,
        env,
        encryptedSecret: serverKey ? encryptCredential(box, orgId, env, serverKey) : null,
        clientKey: clientKey || null,
        merchantId: merchantId || null,
        active,
        userId: c.var.user.userId,
      });
      return c.json({ credential: credentialView(saved) });
    } catch (err) {
      if (err instanceof PaymentRepoError)
        return c.json({ error: err.code, message: err.message }, 400);
      throw err;
    }
  });

  app.post('/orgs/:orgId/integrations/midtrans/test', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const body = z
      .object({ env: z.enum(['sandbox', 'production']) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', message: 'Data tidak valid.' }, 400);
    const cred = await getCredential(c.var.deps.db, orgId, body.data.env);
    if (!cred) return c.json({ error: 'not_found', message: 'Kredensial belum disimpan.' }, 404);
    const result = await c.var.deps.payments.forCredential(cred).testConnection();
    await recordCredentialTest(c.var.deps.db, {
      orgId,
      env: body.data.env,
      ok: result.ok,
      message: result.message,
      userId: c.var.user.userId,
    });
    return c.json(result);
  });

  return app;
}

const MidtransBody = z.object({
  env: z.enum(['sandbox', 'production']),
  /** Empty = keep the stored key. */
  serverKey: z.string().trim().max(200).optional(),
  clientKey: z.string().trim().max(200).optional(),
  merchantId: z.string().trim().max(100).optional(),
  active: z.boolean(),
});

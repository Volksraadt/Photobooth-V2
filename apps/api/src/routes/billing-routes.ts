import type { Context } from 'hono';
import { Hono } from 'hono';
import {
  BillingError,
  createCheckoutInvoice,
  getInvoice,
  getPlanByCode,
  getSessionDetail,
  listInvoices,
  listPlans,
  resolveEntitlements,
} from '@pb/db';
import { PaymentProviderError } from '@pb/payments';
import { z } from 'zod';
import {
  BillingUnavailableError,
  ensureInvoiceCharge,
  invoiceView,
  refreshInvoice,
} from '../billing/invoices';
import { orgMembership, requireOrgEditor } from '../middleware/org-access';
import type { AppEnv } from '../types';

/** Entitlements as the UI and the devices see them (no internal ids). */
export function entitlementView(e: Awaited<ReturnType<typeof resolveEntitlements>>) {
  if (!e) return null;
  return {
    planCode: e.planCode,
    planName: e.planName,
    subscribedPlanCode: e.subscribedPlanCode,
    state: e.state,
    status: e.status,
    periodEnd: e.periodEnd?.toISOString() ?? null,
    graceUntil: e.graceUntil?.toISOString() ?? null,
    limits: e.limits,
    features: e.features,
  };
}

const CheckoutBody = z.object({ planCode: z.enum(['pro', 'business']) });

/** Subscription pages of Studio (mounted inside `/studio`, user token). */
export function studioBillingRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/orgs/:orgId/billing', async (c) => {
    const orgId = c.req.param('orgId');
    if (!(await orgMembership(c, orgId)))
      return c.json({ error: 'not_found', message: 'Organisasi tidak ditemukan.' }, 404);
    const { db, billing } = c.var.deps;
    const [ent, plans, invoices] = await Promise.all([
      resolveEntitlements(db, orgId),
      listPlans(db),
      listInvoices(db, orgId),
    ]);
    return c.json({
      billing: { mode: billing.mode, env: billing.env },
      entitlements: entitlementView(ent),
      plans: plans.map((p) => ({
        code: p.code,
        name: p.name,
        priceMonthly: p.priceMonthly,
        limits: p.limits,
        features: p.features,
      })),
      invoices: invoices.map((r) => invoiceView(r.invoice, { code: r.planCode, name: r.planName })),
    });
  });

  /** Owner/manager picks a plan: creates (or reuses) the invoice and its QRIS. */
  app.post('/orgs/:orgId/billing/checkout', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const body = CheckoutBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', message: 'Paket tidak valid.' }, 400);
    const { deps } = c.var;
    try {
      let invoice = await createCheckoutInvoice(deps.db, { orgId, planCode: body.data.planCode });
      invoice = await ensureInvoiceCharge(deps, invoice);
      const plan = await getPlanByCode(deps.db, body.data.planCode);
      return c.json({
        invoice: invoiceView(invoice, { code: plan?.code ?? null, name: plan?.name ?? null }),
      });
    } catch (err) {
      return billingFailure(c, err);
    }
  });

  /** Polled by the Studio page while the QR is on screen. */
  app.get('/orgs/:orgId/billing/invoices/:invoiceId', async (c) => {
    const orgId = c.req.param('orgId');
    if (!(await orgMembership(c, orgId)))
      return c.json({ error: 'not_found', message: 'Organisasi tidak ditemukan.' }, 404);
    const { deps } = c.var;
    let invoice = await getInvoice(deps.db, c.req.param('invoiceId'));
    if (!invoice || invoice.orgId !== orgId)
      return c.json({ error: 'not_found', message: 'Tagihan tidak ditemukan.' }, 404);
    try {
      invoice = await refreshInvoice(deps, invoice);
    } catch (err) {
      return billingFailure(c, err);
    }
    const planId = invoice.planId;
    const plan = planId ? (await listPlans(deps.db)).find((p) => p.id === planId) : null;
    return c.json({
      invoice: invoiceView(invoice, { code: plan?.code ?? null, name: plan?.name ?? null }),
    });
  });

  /** New QR for an open invoice (the old one expired). Owner/manager. */
  app.post('/orgs/:orgId/billing/invoices/:invoiceId/pay', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const { deps } = c.var;
    const invoice = await getInvoice(deps.db, c.req.param('invoiceId'));
    if (!invoice || invoice.orgId !== orgId)
      return c.json({ error: 'not_found', message: 'Tagihan tidak ditemukan.' }, 404);
    if (invoice.status !== 'pending')
      return c.json(
        { error: 'not_pending', message: 'Tagihan ini sudah tidak menunggu pembayaran.' },
        409,
      );
    try {
      const charged = await ensureInvoiceCharge(deps, invoice);
      const plan = (await listPlans(deps.db)).find((p) => p.id === charged.planId);
      return c.json({
        invoice: invoiceView(charged, { code: plan?.code ?? null, name: plan?.name ?? null }),
      });
    } catch (err) {
      return billingFailure(c, err);
    }
  });

  /** Composite strip of a session (transaction detail), proxied from private storage. */
  app.get('/orgs/:orgId/sessions/:sessionId/thumbnail', async (c) => {
    const orgId = c.req.param('orgId');
    if (!(await orgMembership(c, orgId))) return c.json({ error: 'not_found' }, 404);
    const { db, storage } = c.var.deps;
    const detail = await getSessionDetail(db, orgId, c.req.param('sessionId'));
    if (!detail?.compositePath) return c.json({ error: 'no_thumbnail' }, 404);
    try {
      const bytes = await storage.get(detail.compositePath);
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300' },
      });
    } catch {
      return c.json({ error: 'no_thumbnail' }, 404);
    }
  });

  return app;
}

function billingFailure(c: Context<AppEnv>, err: unknown) {
  if (err instanceof BillingError) {
    const status = err.code === 'not_found' ? 404 : 409;
    return c.json({ error: err.code, message: err.message }, status);
  }
  if (err instanceof BillingUnavailableError)
    return c.json({ error: 'billing_unavailable', message: err.message }, 503);
  if (err instanceof PaymentProviderError) {
    console.error('[api] platform billing provider error:', err.code, err.message);
    return c.json(
      {
        error: 'provider_error',
        message: 'Midtrans tidak dapat dihubungi. Coba lagi sebentar lagi.',
      },
      502,
    );
  }
  throw err;
}

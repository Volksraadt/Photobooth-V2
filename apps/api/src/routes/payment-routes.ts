import {
  applyPaymentStatus,
  getDevicePayment,
  insertPendingPayment,
  listBoothVouchersForDevice,
  markPaymentCanceled,
  markPaymentFailed,
  PAYMENT_GRACE_MS,
  PaymentRepoError,
  priceForConfig,
  redeemVoucher,
  storeCharge,
  type PaymentRow,
} from '@pb/db';
import { PaymentProviderError } from '@pb/payments';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv, AuthedDevice, ResolvedDeps } from '../types';

const Id = z.string().regex(/^[a-z0-9]{16,40}$/);
const SessionRef = z.object({
  id: z.string().min(1).max(64),
  code: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
  startedAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
});

const CreatePaymentBody = z.object({
  /** Chosen by the agent per attempt: retries with the same id are idempotent. */
  paymentId: Id,
  session: SessionRef,
  frameId: z.string().min(1).max(64),
  configVersion: z.number().int().positive(),
  amount: z.number().int().positive().max(100_000_000),
  expirySec: z.number().int().min(60).max(3600),
});

const RedeemBody = z.object({
  codeHash: z.string().regex(/^[a-f0-9]{64}$/),
  session: SessionRef,
  amount: z.number().int().nonnegative(),
  usedAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  offline: z.boolean().default(false),
});

/** Only these fields ever leave the API towards a device. */
export function devicePaymentView(p: PaymentRow) {
  return {
    id: p.id,
    status: p.status,
    amount: p.amount,
    qrString: p.status === 'pending' ? p.qrString : null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
  };
}

/** A charge row older than this without a QR string is treated as a crashed attempt. */
const STALE_CHARGE_MS = 30_000;
/** Device polling may query the provider at most this often per payment. */
const PROVIDER_CHECK_MS = 3_000;

export function webhookUrl(deps: ResolvedDeps, orgId: string): string | null {
  return deps.publicApiUrl ? `${deps.publicApiUrl}/webhooks/midtrans/${orgId}` : null;
}

function repoError(c: Context<AppEnv>, err: unknown) {
  if (err instanceof PaymentRepoError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'amount_mismatch' ? 422 : 409;
    return c.json({ error: err.code, message: err.message }, status);
  }
  throw err;
}

/** Asks the provider for the real status (device polling fallback, rate limited). */
export async function refreshFromProvider(
  deps: ResolvedDeps,
  device: Pick<AuthedDevice, 'orgId'>,
  payment: PaymentRow,
): Promise<PaymentRow> {
  if (payment.status !== 'pending') return payment;
  const now = Date.now();
  let current = payment;
  if (!payment.lastCheckedAt || now - payment.lastCheckedAt.getTime() >= PROVIDER_CHECK_MS) {
    const resolved = await deps.payments.forOrg(deps.db, device.orgId, payment.env);
    if (resolved) {
      try {
        const update = await resolved.provider.getStatus(payment.orderId);
        const res = await applyPaymentStatus(deps.db, device.orgId, payment.id, {
          status: update?.status ?? null,
          grossAmount: update?.grossAmount ?? null,
          providerRef: update?.providerRef ?? null,
          paidAt: update?.paidAt ?? null,
          raw: update?.raw ?? null,
          source: 'poll',
        });
        current = res.payment;
        if (res.changed)
          deps.deviceSignals.emit(current.deviceId, {
            paymentId: current.id,
            status: current.status,
          });
      } catch (err) {
        if (!(err instanceof PaymentProviderError)) throw err;
      }
    }
  }
  if (
    current.status === 'pending' &&
    current.expiresAt &&
    now > current.expiresAt.getTime() + PAYMENT_GRACE_MS
  ) {
    current = (
      await applyPaymentStatus(deps.db, device.orgId, current.id, {
        status: 'expired',
        grossAmount: null,
        providerRef: null,
        paidAt: null,
        raw: null,
        source: 'expiry',
      })
    ).payment;
  }
  return current;
}

/** `/device/payments/*` and `/device/vouchers/*` (device token; mounted under deviceRoutes). */
export function devicePaymentRoutes() {
  const app = new Hono<AppEnv>();

  app.post('/payments', async (c) => {
    const body = CreatePaymentBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
    const { deps, device } = c.var;
    const input = body.data;
    if (!device.boothId) return c.json({ error: 'no_booth' }, 409);

    // The amount must be the price of that frame in the config version the kiosk runs.
    const price = await priceForConfig(deps.db, device, input.configVersion, input.frameId);
    if (price === null)
      return c.json({ error: 'unknown_config', message: 'Frame/versi config tidak dikenal' }, 422);
    if (price !== input.amount) {
      return c.json({ error: 'amount_mismatch', message: 'Nominal tidak sesuai harga frame' }, 422);
    }

    const resolved = await deps.payments.forOrg(deps.db, device.orgId);
    if (!resolved) {
      return c.json(
        { error: 'payment_not_configured', message: 'Midtrans belum diatur di Studio' },
        409,
      );
    }

    let result: Awaited<ReturnType<typeof insertPendingPayment>>;
    try {
      result = await insertPendingPayment(deps.db, device, {
        paymentId: input.paymentId,
        session: input.session,
        amount: input.amount,
        env: resolved.env,
        provider: 'midtrans',
        expiresAt: new Date(Date.now() + input.expirySec * 1000),
      });
    } catch (err) {
      return repoError(c, err);
    }
    const { payment, created } = result;

    if (!created) {
      if (payment.qrString || payment.status !== 'pending')
        return c.json(devicePaymentView(payment));
      if (Date.now() - payment.createdAt.getTime() > STALE_CHARGE_MS) {
        await markPaymentFailed(deps.db, payment.id, 'charge did not complete');
        return c.json(
          { error: 'payment_failed', message: 'Percobaan pembayaran gagal; buat ulang' },
          502,
        );
      }
      return c.json({ error: 'in_progress', message: 'QRIS sedang dibuat' }, 409);
    }

    try {
      const charge = await resolved.provider.createQris({
        orderId: payment.orderId,
        amount: payment.amount,
        expirySec: input.expirySec,
        notificationUrl: webhookUrl(deps, device.orgId),
      });
      await storeCharge(deps.db, payment.id, charge);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'provider error';
      await markPaymentFailed(deps.db, payment.id, message);
      console.warn(`[api] QRIS charge failed for payment ${payment.id}: ${message}`);
      return c.json({ error: 'provider_error', message }, 502);
    }
    const stored = await getDevicePayment(deps.db, device, payment.id);
    return c.json(devicePaymentView(stored!), 201);
  });

  app.get('/payments/:id', async (c) => {
    const { deps, device } = c.var;
    const payment = await getDevicePayment(deps.db, device, c.req.param('id'));
    if (!payment) return c.json({ error: 'not_found' }, 404);
    return c.json(devicePaymentView(await refreshFromProvider(deps, device, payment)));
  });

  /** Buyer went back / timed out. Pending → canceled; a settlement found now becomes paid_late. */
  app.post('/payments/:id/cancel', async (c) => {
    const { deps, device } = c.var;
    const payment = await markPaymentCanceled(deps.db, device, c.req.param('id'));
    if (!payment) return c.json({ error: 'not_found' }, 404);
    let current = payment;
    const resolved = await deps.payments.forOrg(deps.db, device.orgId, payment.env);
    if (resolved && payment.status === 'canceled') {
      try {
        const update = await resolved.provider.cancel(payment.orderId);
        if (update?.status === 'paid') {
          const res = await applyPaymentStatus(deps.db, device.orgId, payment.id, {
            ...update,
            source: 'cancel',
          });
          current = res.payment;
        }
      } catch (err) {
        // Provider unreachable: our row is canceled; a later settlement becomes paid_late.
        if (!(err instanceof PaymentProviderError)) throw err;
      }
    }
    return c.json(devicePaymentView(current));
  });

  /** Voucher hashes of the device's booth, for offline validation. */
  app.get('/vouchers', async (c) => {
    const { deps, device } = c.var;
    const rows = await listBoothVouchersForDevice(deps.db, device);
    c.header('Cache-Control', 'no-store');
    return c.json({
      vouchers: rows.map((v) => ({
        codeHash: v.codeHash,
        valueType: v.valueType,
        value: v.value,
        expiresAt: v.expiresAt?.toISOString() ?? null,
        usedAt: v.usedAt?.toISOString() ?? null,
      })),
    });
  });

  app.post('/vouchers/redeem', async (c) => {
    const body = RedeemBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
    try {
      const result = await redeemVoucher(c.var.deps.db, c.var.device, body.data);
      return c.json(result);
    } catch (err) {
      return repoError(c, err);
    }
  });

  return app;
}

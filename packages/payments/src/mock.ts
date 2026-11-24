import { constantTimeEqualHex, midtransSignature, parseIdr } from './signature';
import {
  PaymentProviderError,
  type CreateQrisInput,
  type PaymentProvider,
  type PaymentStatusUpdate,
  type ProviderPaymentStatus,
} from './types';

type MockOrder = {
  orderId: string;
  amount: number;
  status: ProviderPaymentStatus;
  expiresAt: Date;
  notificationUrl: string | null;
  transactionId: string;
};

export type MockProvider = PaymentProvider & {
  readonly orders: Map<string, MockOrder>;
  /**
   * Marks the order paid and returns a Midtrans-shaped notification signed with the mock
   * server key (so the real webhook path verifies it).
   */
  simulatePaid(orderId: string): Record<string, string>;
  /** Signed notification for an arbitrary status (expire, cancel, …). */
  notification(orderId: string, transactionStatus: string): Record<string, string>;
  /** Next createQris/getStatus calls fail with a network error. */
  failNext(count?: number): void;
};

const MIDTRANS_STATUS: Record<ProviderPaymentStatus, [string, string]> = {
  pending: ['pending', '201'],
  paid: ['settlement', '200'],
  expired: ['expire', '202'],
  canceled: ['cancel', '200'],
  failed: ['deny', '202'],
};

/**
 * In-memory provider with Midtrans semantics (order ids, statuses, notification signature).
 * Used by tests and by `PB_PAYMENT_PROVIDER=mock` for dev without a Midtrans account.
 */
export function createMockProvider(opts: { serverKey: string }): MockProvider {
  const orders = new Map<string, MockOrder>();
  let failures = 0;
  let seq = 0;

  const maybeFail = () => {
    if (failures > 0) {
      failures--;
      throw new PaymentProviderError('network', 'Mock provider: simulated network error');
    }
  };

  const toUpdate = (o: MockOrder): PaymentStatusUpdate => ({
    orderId: o.orderId,
    status: o.status,
    grossAmount: o.amount,
    providerRef: o.transactionId,
    paidAt: o.status === 'paid' ? new Date() : null,
    raw: { mock: true, transaction_status: MIDTRANS_STATUS[o.status][0] },
  });

  const effective = (o: MockOrder) => {
    if (o.status === 'pending' && o.expiresAt.getTime() < Date.now()) o.status = 'expired';
    return o;
  };

  const notification = (orderId: string, transactionStatus: string) => {
    const o = orders.get(orderId);
    const statusCode =
      Object.values(MIDTRANS_STATUS).find(([s]) => s === transactionStatus)?.[1] ?? '200';
    const gross = `${o?.amount ?? 0}.00`;
    return {
      transaction_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
      transaction_status: transactionStatus,
      transaction_id: o?.transactionId ?? 'unknown',
      status_message: 'mock notification',
      status_code: statusCode,
      signature_key: midtransSignature(orderId, statusCode, gross, opts.serverKey),
      payment_type: 'qris',
      order_id: orderId,
      gross_amount: gross,
      fraud_status: 'accept',
      currency: 'IDR',
      acquirer: 'gopay',
    };
  };

  return {
    id: 'mock',
    orders,

    async createQris(input: CreateQrisInput) {
      maybeFail();
      if (orders.has(input.orderId)) {
        throw new PaymentProviderError('rejected', 'order_id sudah dipakai', '406');
      }
      const o: MockOrder = {
        orderId: input.orderId,
        amount: input.amount,
        status: 'pending',
        expiresAt: new Date(Date.now() + input.expirySec * 1000),
        notificationUrl: input.notificationUrl ?? null,
        transactionId: `mock-tx-${++seq}`,
      };
      orders.set(o.orderId, o);
      return {
        orderId: o.orderId,
        qrString: `00020101021226MOCKQRIS|${o.orderId}|IDR${o.amount}`,
        expiresAt: o.expiresAt,
        providerRef: o.transactionId,
        raw: { mock: true },
      };
    },

    async getStatus(orderId) {
      maybeFail();
      const o = orders.get(orderId);
      return o ? toUpdate(effective(o)) : null;
    },

    async cancel(orderId) {
      maybeFail();
      const o = orders.get(orderId);
      if (!o) return null;
      if (effective(o).status === 'pending') o.status = 'canceled';
      return toUpdate(o);
    },

    async verifyWebhook(_headers, raw) {
      const body = raw as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return null;
      const { order_id, status_code, gross_amount, signature_key, transaction_status } = body;
      if (
        typeof order_id !== 'string' ||
        typeof status_code !== 'string' ||
        typeof gross_amount !== 'string' ||
        typeof signature_key !== 'string'
      ) {
        return null;
      }
      const expected = midtransSignature(order_id, status_code, gross_amount, opts.serverKey);
      if (!constantTimeEqualHex(expected, signature_key)) return null;
      const status =
        (Object.entries(MIDTRANS_STATUS).find(
          ([, [s]]) => s === transaction_status,
        )?.[0] as ProviderPaymentStatus) ?? null;
      return {
        orderId: order_id,
        status,
        grossAmount: parseIdr(gross_amount),
        providerRef: typeof body.transaction_id === 'string' ? body.transaction_id : null,
        paidAt: status === 'paid' ? new Date() : null,
        raw: body,
      };
    },

    async testConnection() {
      return { ok: true, message: 'Mock provider (tanpa Midtrans).' };
    },

    simulatePaid(orderId) {
      const o = orders.get(orderId);
      if (o) o.status = 'paid';
      return notification(orderId, 'settlement');
    },

    notification,

    failNext(count = 1) {
      failures = count;
    },
  };
}

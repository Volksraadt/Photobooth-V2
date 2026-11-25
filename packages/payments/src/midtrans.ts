import { randomBytes } from 'node:crypto';
import { matchesMidtransSignature, parseIdr } from './signature';
import {
  PaymentProviderError,
  type ConnectionTestResult,
  type CreateQrisInput,
  type PaymentProvider,
  type PaymentStatusUpdate,
  type ProviderEnv,
  type ProviderPaymentStatus,
  type QrisCharge,
} from './types';

export type MidtransOptions = {
  serverKey: string;
  /**
   * Keys that may sign HTTP notifications: the Signature Secret Key and, while Midtrans still
   * retries notifications signed before a regeneration, the previous one. The server key is
   * always accepted too (accounts created before 2026-10-28 sign with a key equal to it).
   */
  signatureKeys?: readonly (string | null | undefined)[];
  env: ProviderEnv;
  /** Injected in tests. */
  fetch?: typeof fetch;
  /** Decodes a QR PNG to its payload (when the charge response has no `qr_string`). */
  decodeQrImage?: (png: Uint8Array) => Promise<string | null>;
  timeoutMs?: number;
};

export const MIDTRANS_BASE: Record<ProviderEnv, string> = {
  sandbox: 'https://api.sandbox.midtrans.com',
  production: 'https://api.midtrans.com',
};

type MidtransBody = Record<string, unknown> & {
  status_code?: string;
  status_message?: string;
  transaction_status?: string;
  fraud_status?: string;
  order_id?: string;
  transaction_id?: string;
  gross_amount?: string;
  settlement_time?: string;
  expiry_time?: string;
  qr_string?: string;
  signature_key?: string;
  actions?: { name?: string; method?: string; url?: string }[];
};

/** Midtrans timestamps are "YYYY-MM-DD HH:mm:ss" in GMT+7. */
export function parseMidtransTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapMidtransStatus(
  transactionStatus: string | undefined,
  fraudStatus?: string,
): ProviderPaymentStatus | null {
  switch (transactionStatus) {
    case 'settlement':
      return 'paid';
    case 'capture':
      return fraudStatus === 'accept' || fraudStatus === undefined ? 'paid' : 'pending';
    case 'pending':
      return 'pending';
    case 'expire':
      return 'expired';
    case 'cancel':
      return 'canceled';
    case 'deny':
    case 'failure':
      return 'failed';
    default:
      return null; // refund, partial_refund, authorize: not acted on
  }
}

function toUpdate(body: MidtransBody, orderId: string): PaymentStatusUpdate {
  const status = mapMidtransStatus(body.transaction_status, body.fraud_status);
  // The notification signature is not kept: `raw` is stored and readable by org members.
  const { signature_key: _signature, ...raw } = body;
  return {
    orderId: body.order_id ?? orderId,
    status,
    grossAmount: parseIdr(body.gross_amount),
    providerRef: body.transaction_id ?? null,
    paidAt: status === 'paid' ? (parseMidtransTime(body.settlement_time) ?? new Date()) : null,
    raw,
  };
}

/**
 * Midtrans Core API, QRIS (`payment_type: qris`), with the owner's server key.
 * The key only goes into the Authorization header; it is never logged, returned or put in errors.
 */
export function createMidtransProvider(opts: MidtransOptions): PaymentProvider {
  const base = MIDTRANS_BASE[opts.env];
  const doFetch = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.serverKey}:`, 'utf8').toString('base64')}`;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<MidtransBody> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: auth,
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new PaymentProviderError(
        'network',
        `Midtrans tidak dapat dihubungi (${err instanceof Error ? err.name : 'error'})`,
      );
    }
    const json = (await res.json().catch(() => null)) as MidtransBody | null;
    if (!json || typeof json !== 'object') {
      throw new PaymentProviderError(
        'invalid_response',
        `Respons Midtrans tidak valid (HTTP ${res.status})`,
      );
    }
    // Midtrans puts the real outcome in the body status_code (HTTP is often 200).
    const code = json.status_code ?? String(res.status);
    if (code === '401' || res.status === 401) {
      throw new PaymentProviderError('auth', 'Server key Midtrans ditolak', code);
    }
    return { ...json, status_code: code };
  }

  async function qrFromActions(body: MidtransBody): Promise<string | null> {
    const action =
      body.actions?.find((a) => a.name === 'generate-qr-code') ??
      body.actions?.find((a) => a.name?.startsWith('generate-qr-code'));
    if (!action?.url || !opts.decodeQrImage) return null;
    const url = new URL(action.url);
    const midtransHost = /(^|\.)midtrans\.com$/.test(url.hostname);
    const res = await doFetch(url, {
      headers: midtransHost ? { authorization: auth } : {},
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);
    if (!res?.ok) return null;
    return opts.decodeQrImage(new Uint8Array(await res.arrayBuffer()));
  }

  return {
    id: 'midtrans',

    async createQris(input: CreateQrisInput): Promise<QrisCharge> {
      const headers: Record<string, string> = {};
      if (input.notificationUrl) headers['X-Override-Notification'] = input.notificationUrl;
      const body = await call(
        'POST',
        '/v2/charge',
        {
          payment_type: 'qris',
          transaction_details: { order_id: input.orderId, gross_amount: input.amount },
          qris: { acquirer: 'gopay' },
          custom_expiry: {
            expiry_duration: Math.max(60, Math.round(input.expirySec)),
            unit: 'second',
          },
        },
        headers,
      );
      if (body.status_code !== '201') {
        throw new PaymentProviderError(
          'rejected',
          `Midtrans menolak pembuatan QRIS (${body.status_code}: ${String(body.status_message ?? '').slice(0, 200)})`,
          body.status_code,
        );
      }
      const qrString = body.qr_string || (await qrFromActions(body));
      if (!qrString) {
        throw new PaymentProviderError('invalid_response', 'Midtrans tidak mengirim kode QRIS');
      }
      return {
        orderId: input.orderId,
        qrString,
        expiresAt:
          parseMidtransTime(body.expiry_time) ?? new Date(Date.now() + input.expirySec * 1000),
        providerRef: body.transaction_id ?? null,
        raw: body,
      };
    },

    async getStatus(orderId) {
      const body = await call('GET', `/v2/${encodeURIComponent(orderId)}/status`);
      if (body.status_code === '404') return null;
      if (!body.transaction_status) {
        throw new PaymentProviderError(
          'invalid_response',
          `Status Midtrans tidak dikenali (${body.status_code})`,
          body.status_code,
        );
      }
      return toUpdate(body, orderId);
    },

    async cancel(orderId) {
      const body = await call('POST', `/v2/${encodeURIComponent(orderId)}/cancel`);
      if (body.status_code === '200' && body.transaction_status) return toUpdate(body, orderId);
      // 412 = cannot be modified (already settled/expired), 404 = never charged: ask for the truth.
      return this.getStatus(orderId);
    },

    async verifyWebhook(_headers, raw) {
      if (!raw || typeof raw !== 'object') return null;
      const body = raw as MidtransBody;
      const { order_id, status_code, gross_amount, signature_key } = body;
      if (
        typeof order_id !== 'string' ||
        typeof status_code !== 'string' ||
        typeof gross_amount !== 'string' ||
        typeof signature_key !== 'string'
      ) {
        return null;
      }
      const fields = {
        orderId: order_id,
        statusCode: status_code,
        grossAmount: gross_amount,
        signature: signature_key,
      };
      if (!matchesMidtransSignature(fields, [...(opts.signatureKeys ?? []), opts.serverKey])) {
        return null;
      }
      return toUpdate(body, order_id);
    },

    async testConnection(): Promise<ConnectionTestResult> {
      // Status of an order that cannot exist: 404 = key accepted, 401 = key rejected.
      const probe = `pb-connection-test-${randomBytes(6).toString('hex')}`;
      try {
        const body = await call('GET', `/v2/${probe}/status`);
        if (body.status_code === '404' || body.status_code === '200') {
          return { ok: true, message: `Terhubung ke Midtrans ${opts.env}.` };
        }
        return { ok: false, message: `Midtrans menjawab kode ${body.status_code}.` };
      } catch (err) {
        if (err instanceof PaymentProviderError && err.code === 'auth') {
          return {
            ok: false,
            message: `Server key ditolak Midtrans ${opts.env}. Pastikan key untuk lingkungan yang benar.`,
          };
        }
        return { ok: false, message: err instanceof Error ? err.message : 'Tes koneksi gagal.' };
      }
    },
  };
}

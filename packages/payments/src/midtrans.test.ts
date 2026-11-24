import { describe, expect, it, vi } from 'vitest';
import { createMidtransProvider, mapMidtransStatus, parseMidtransTime } from './midtrans';
import { createMockProvider } from './mock';
import { midtransSignature } from './signature';
import { PaymentProviderError } from './types';

const SERVER_KEY = 'SB-Mid-server-TESTKEY123456';

function fakeFetch(
  handler: (url: string, init: RequestInit) => { status?: number; body: unknown },
) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const { status = 200, body } = handler(String(input), init);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('midtrans provider', () => {
  it('charges QRIS with basic auth, custom expiry and override notification', async () => {
    const f = fakeFetch((url, init) => {
      expect(url).toBe('https://api.sandbox.midtrans.com/v2/charge');
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe(
        `Basic ${Buffer.from(`${SERVER_KEY}:`).toString('base64')}`,
      );
      expect(headers['X-Override-Notification']).toBe('https://api.test/webhooks/midtrans/org1');
      expect(JSON.parse(String(init.body))).toEqual({
        payment_type: 'qris',
        transaction_details: { order_id: 'order-1', gross_amount: 35000 },
        qris: { acquirer: 'gopay' },
        custom_expiry: { expiry_duration: 300, unit: 'second' },
      });
      return {
        body: {
          status_code: '201',
          transaction_id: 'tx-1',
          order_id: 'order-1',
          gross_amount: '35000.00',
          transaction_status: 'pending',
          qr_string: '00020101021226QRIS',
          expiry_time: '2026-11-24 12:05:00',
        },
      };
    });
    const p = createMidtransProvider({ serverKey: SERVER_KEY, env: 'sandbox', fetch: f });
    const charge = await p.createQris({
      orderId: 'order-1',
      amount: 35000,
      expirySec: 300,
      notificationUrl: 'https://api.test/webhooks/midtrans/org1',
    });
    expect(charge.qrString).toBe('00020101021226QRIS');
    expect(charge.providerRef).toBe('tx-1');
    expect(charge.expiresAt.toISOString()).toBe('2026-11-24T05:05:00.000Z');
  });

  it('falls back to decoding the QR image when qr_string is missing', async () => {
    const f = fakeFetch((url) =>
      url.endsWith('/v2/charge')
        ? {
            body: {
              status_code: '201',
              transaction_id: 'tx-2',
              actions: [
                {
                  name: 'generate-qr-code',
                  url: 'https://api.sandbox.midtrans.com/v2/qris/tx-2/qr-code',
                },
              ],
            },
          }
        : { body: {} },
    );
    const decode = vi.fn(async () => 'DECODED-QR');
    const p = createMidtransProvider({
      serverKey: SERVER_KEY,
      env: 'sandbox',
      fetch: f,
      decodeQrImage: decode,
    });
    const charge = await p.createQris({ orderId: 'o2', amount: 1000, expirySec: 120 });
    expect(charge.qrString).toBe('DECODED-QR');
    expect(decode).toHaveBeenCalledOnce();
  });

  it('errors never contain the server key', async () => {
    const f = fakeFetch(() => ({
      status: 401,
      body: { status_code: '401', status_message: 'unauthorized' },
    }));
    const p = createMidtransProvider({ serverKey: SERVER_KEY, env: 'production', fetch: f });
    const err = await p
      .createQris({ orderId: 'o', amount: 1, expirySec: 60 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as PaymentProviderError).code).toBe('auth');
    expect(JSON.stringify(err) + String(err)).not.toContain(SERVER_KEY);
    const test = await p.testConnection();
    expect(test.ok).toBe(false);
    expect(test.message).not.toContain(SERVER_KEY);
  });

  it('testConnection: 404 for an unknown order means the key works', async () => {
    const f = fakeFetch(() => ({
      body: { status_code: '404', status_message: "Transaction doesn't exist." },
    }));
    const p = createMidtransProvider({ serverKey: SERVER_KEY, env: 'sandbox', fetch: f });
    expect((await p.testConnection()).ok).toBe(true);
    expect(await p.getStatus('nope')).toBeNull();
  });

  it('verifies the notification signature (sha512) and rejects tampering', async () => {
    const p = createMidtransProvider({
      serverKey: SERVER_KEY,
      env: 'sandbox',
      fetch: fakeFetch(() => ({ body: {} })),
    });
    const body = {
      order_id: 'order-9',
      status_code: '200',
      gross_amount: '35000.00',
      transaction_status: 'settlement',
      transaction_id: 'tx-9',
      settlement_time: '2026-11-24 10:00:00',
      signature_key: midtransSignature('order-9', '200', '35000.00', SERVER_KEY),
    };
    const ok = await p.verifyWebhook(new Headers(), body);
    expect(ok).toMatchObject({
      orderId: 'order-9',
      status: 'paid',
      grossAmount: 35000,
      providerRef: 'tx-9',
    });
    expect(ok?.paidAt?.toISOString()).toBe('2026-11-24T03:00:00.000Z');
    expect(await p.verifyWebhook(new Headers(), { ...body, gross_amount: '1.00' })).toBeNull();
    expect(
      await p.verifyWebhook(new Headers(), { ...body, signature_key: 'ab'.repeat(64) }),
    ).toBeNull();
    expect(await p.verifyWebhook(new Headers(), { ...body, signature_key: undefined })).toBeNull();
    const other = createMidtransProvider({ serverKey: 'other-key', env: 'sandbox' });
    expect(await other.verifyWebhook(new Headers(), body)).toBeNull();
  });

  it('cancel falls back to the real status when Midtrans refuses (already settled)', async () => {
    const f = fakeFetch((url) =>
      url.endsWith('/cancel')
        ? {
            body: {
              status_code: '412',
              status_message: 'Merchant cannot modify the status of the transaction',
            },
          }
        : {
            body: {
              status_code: '200',
              transaction_status: 'settlement',
              order_id: 'o',
              gross_amount: '5000.00',
            },
          },
    );
    const p = createMidtransProvider({ serverKey: SERVER_KEY, env: 'sandbox', fetch: f });
    expect(await p.cancel('o')).toMatchObject({ status: 'paid', grossAmount: 5000 });
  });

  it('maps statuses and times', () => {
    expect(mapMidtransStatus('settlement')).toBe('paid');
    expect(mapMidtransStatus('expire')).toBe('expired');
    expect(mapMidtransStatus('cancel')).toBe('canceled');
    expect(mapMidtransStatus('deny')).toBe('failed');
    expect(mapMidtransStatus('refund')).toBeNull();
    expect(mapMidtransStatus('capture', 'challenge')).toBe('pending');
    expect(parseMidtransTime('garbage')).toBeNull();
  });
});

describe('mock provider', () => {
  it('signs notifications like Midtrans', async () => {
    const mock = createMockProvider({ serverKey: 'mock-key' });
    await mock.createQris({ orderId: 'm1', amount: 20000, expirySec: 60 });
    const n = mock.simulatePaid('m1');
    expect(await mock.verifyWebhook(new Headers(), n)).toMatchObject({
      status: 'paid',
      grossAmount: 20000,
    });
    expect(await mock.verifyWebhook(new Headers(), { ...n, signature_key: 'x' })).toBeNull();
    await expect(mock.createQris({ orderId: 'm1', amount: 1, expirySec: 60 })).rejects.toThrow();
  });
});

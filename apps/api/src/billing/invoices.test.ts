import type { InvoiceRow } from '@pb/db';
import { describe, expect, it } from 'vitest';
import { invoiceView } from './invoices';

const now = new Date('2026-11-25T03:00:00Z');
const plan = { code: 'pro', name: 'Pro' };

function row(patch: Partial<InvoiceRow>): InvoiceRow {
  return {
    id: 'inv-1',
    status: 'pending',
    kind: 'renewal',
    amount: 150000,
    periodStart: null,
    periodEnd: null,
    dueAt: null,
    paidAt: null,
    createdAt: now,
    qrString: null,
    qrExpiresAt: null,
    ...patch,
  } as InvoiceRow;
}

describe('invoiceView QR state', () => {
  it('a renewal made by the worker has no QR yet and is not "expired"', () => {
    const v = invoiceView(row({}), plan, now);
    expect(v.qrString).toBeNull();
    expect(v.qrExpired).toBe(false);
  });

  it('a live QR is shown', () => {
    const v = invoiceView(
      row({ qrString: 'QR', qrExpiresAt: new Date(now.getTime() + 60_000) }),
      plan,
      now,
    );
    expect(v.qrString).toBe('QR');
    expect(v.qrExpired).toBe(false);
  });

  it('an issued QR past its expiry is hidden and flagged expired', () => {
    const v = invoiceView(
      row({ qrString: 'QR', qrExpiresAt: new Date(now.getTime() - 60_000) }),
      plan,
      now,
    );
    expect(v.qrString).toBeNull();
    expect(v.qrExpired).toBe(true);
  });

  it('a paid invoice is never "expired"', () => {
    const v = invoiceView(
      row({ status: 'paid', qrString: 'QR', qrExpiresAt: new Date(now.getTime() - 60_000) }),
      plan,
      now,
    );
    expect(v.qrExpired).toBe(false);
  });
});

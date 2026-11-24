import type { CreatePaymentInput, CreatePaymentOutput } from '@pb/flow';

/**
 * F1 payment stand-in: issues a fake QRIS string locally. No provider, no secret.
 * The buyer "pays" via the dev button (or test hook) which sends PAYMENT.PAID.
 * F4 replaces this with agent → API → Midtrans.
 */
export const mockPayments = {
  pending: new Map<string, CreatePaymentInput>(),

  async create(input: CreatePaymentInput): Promise<CreatePaymentOutput> {
    await new Promise((r) => setTimeout(r, 300));
    const paymentId = `mock-${input.sessionCode}-${Date.now().toString(36)}`;
    this.pending.set(paymentId, input);
    return {
      paymentId,
      qrString: `MOCK-QRIS|${paymentId}|IDR${input.amount}`,
      expiresAt: new Date(Date.now() + input.expirySec * 1000).toISOString(),
    };
  },

  cancel(paymentId: string | null | undefined): void {
    if (paymentId) this.pending.delete(paymentId);
  },
};

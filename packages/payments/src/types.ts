/** Normalised payment status (mirrors `payments.status` minus `paid_late`, which is our own rule). */
export type ProviderPaymentStatus = 'pending' | 'paid' | 'expired' | 'canceled' | 'failed';

export type ProviderEnv = 'sandbox' | 'production';

export type QrisCharge = {
  orderId: string;
  /** EMVCo QRIS payload rendered by the kiosk `qris` element. */
  qrString: string;
  expiresAt: Date;
  /** Provider transaction id. */
  providerRef: string | null;
  /** Provider response, safe to store (never contains credentials). */
  raw: unknown;
};

/** Result of a status query or a verified notification. */
export type PaymentStatusUpdate = {
  orderId: string;
  /** null = a status we do not act on (refund, authorize, …). */
  status: ProviderPaymentStatus | null;
  /** IDR, integer. null when the provider did not send it. */
  grossAmount: number | null;
  providerRef: string | null;
  paidAt: Date | null;
  raw: unknown;
};

export type WebhookEvent = PaymentStatusUpdate;

export type ConnectionTestResult = { ok: boolean; message: string };

export type CreateQrisInput = {
  orderId: string;
  /** IDR, integer > 0. */
  amount: number;
  expirySec: number;
  /** Per-transaction notification URL (Midtrans `X-Override-Notification`). */
  notificationUrl?: string | null;
};

/**
 * One payment gateway account (the owner's). Implementations never log or return credentials.
 * See docs/architecture.md §3.2.
 */
export interface PaymentProvider {
  readonly id: 'midtrans' | 'xendit' | 'mock';
  createQris(input: CreateQrisInput): Promise<QrisCharge>;
  /** null = the provider does not know the order. */
  getStatus(orderId: string): Promise<PaymentStatusUpdate | null>;
  /** Best effort; returns the status after the attempt (e.g. already paid). */
  cancel(orderId: string): Promise<PaymentStatusUpdate | null>;
  /** null = signature invalid / not a notification of this account. */
  verifyWebhook(headers: Headers, body: unknown): Promise<WebhookEvent | null>;
  testConnection(): Promise<ConnectionTestResult>;
}

export type PaymentProviderErrorCode = 'auth' | 'network' | 'rejected' | 'invalid_response';

export class PaymentProviderError extends Error {
  constructor(
    readonly code: PaymentProviderErrorCode,
    message: string,
    readonly providerStatus?: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

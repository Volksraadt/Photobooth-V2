import { createId } from '@paralleldrive/cuid2';
import { hashVoucherCode, normalizeVoucherCode } from '@pb/crypto';
import { verifyAdminPin } from '@pb/schema';
import type { ConfigSync } from './config-sync';
import {
  DeviceApiError,
  type DevicePayment,
  type DeviceApi,
  type RedeemResult,
} from './device-api';
import type { AgentStore, OutboxRow } from './store';
import type { Telemetry } from './telemetry';

export type SessionInfo = {
  id: string;
  code: string;
  startedAt: string;
  boothId: string;
  configVersion: number;
};

export class MoneyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'MoneyError';
  }
}

export type VoucherOutcome = RedeemResult & { offline: boolean };

const VOUCHER_SYNC_MS = 60_000;
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 60_000;
const PIN_STATE_KEY = 'cash.pinState';

const isNetworkError = (err: unknown) => !(err instanceof DeviceApiError);

/**
 * Buyer payments on the device (F4). QRIS goes through apps/api (the agent never sees provider
 * credentials). Vouchers and cash work offline: they are validated / approved locally, written to
 * SQLite and delivered through the outbox when the API is reachable again.
 */
export class MoneyService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing: Promise<void> | null = null;

  /** Wrong-PIN counter, kept in SQLite so restarting the agent does not reset it (audit R2). */
  private get pin(): { failures: number; lockedUntil: number } {
    try {
      const raw = this.store.getMeta(PIN_STATE_KEY);
      const v = raw ? (JSON.parse(raw) as { failures?: number; lockedUntil?: number }) : {};
      return { failures: v.failures ?? 0, lockedUntil: v.lockedUntil ?? 0 };
    } catch {
      return { failures: 0, lockedUntil: 0 };
    }
  }
  private set pin(v: { failures: number; lockedUntil: number }) {
    this.store.setMeta(PIN_STATE_KEY, JSON.stringify(v));
  }

  constructor(
    private readonly store: AgentStore,
    private readonly config: ConfigSync,
    private readonly telemetry: Telemetry,
    private readonly broadcast: (msg: {
      type: 'payment';
      paymentId: string;
      status: string;
    }) => void,
    private readonly event: (
      kind: string,
      message: string,
      level?: 'info' | 'warn' | 'error',
      data?: unknown,
    ) => void,
  ) {
    config.onPaymentSignal = (d) =>
      this.broadcast({ type: 'payment', paymentId: d.paymentId, status: d.status });
    telemetry.onDelivered = (rows) => this.delivered(rows);
    telemetry.subscribe((online) => online && void this.syncVouchers());
    config.subscribe((s) => s.status === 'ready' && void this.syncVouchers());
  }

  private get api(): DeviceApi {
    return this.config.api;
  }

  start(intervalMs = VOUCHER_SYNC_MS) {
    void this.syncVouchers();
    this.timer = setInterval(() => void this.syncVouchers(), intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private boothId(): string | null {
    const s = this.config.current;
    return s.status === 'ready' ? s.config.boothId : null;
  }

  /** Runs an API call and feeds the result into online/offline detection. */
  private async online<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const v = await fn();
      this.telemetry.report(null);
      return v;
    } catch (err) {
      this.telemetry.report(err);
      throw err;
    }
  }

  // --- QRIS ---

  async createPayment(input: {
    session: SessionInfo;
    frameId: string;
    amount: number;
    expirySec: number;
  }): Promise<DevicePayment> {
    if (!this.api.hasToken) throw new MoneyError('not_paired', 'Perangkat belum terpasang', 409);
    this.store.ensureSession(input.session);
    const body = {
      paymentId: createId(),
      session: {
        id: input.session.id,
        code: input.session.code,
        startedAt: input.session.startedAt,
      },
      frameId: input.frameId,
      configVersion: input.session.configVersion,
      amount: input.amount,
      expirySec: input.expirySec,
    };
    // One retry with the same payment id: the API makes it idempotent (no second QR).
    for (let attempt = 1; ; attempt++) {
      try {
        const p = await this.online(() => this.api.createPayment(body));
        return p;
      } catch (err) {
        if (isNetworkError(err)) {
          if (attempt < 2) continue;
          throw new MoneyError('offline', 'API tidak dapat dihubungi', 503);
        }
        const e = err as DeviceApiError;
        if (e.status === 409 && e.code === 'in_progress' && attempt < 4) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        if (e.code === 'already_paid') {
          // Paid while we could not see it (audit T2): the kiosk continues the session.
          this.event('payment_already_paid', `Sesi ${input.session.code} sudah lunas di server`);
          throw new MoneyError('already_paid', e.message, 409);
        }
        this.event('payment_failed', `QRIS gagal dibuat: ${e.message}`, 'warn', { code: e.code });
        throw new MoneyError(
          e.code ?? 'payment_failed',
          e.message,
          e.status >= 500 ? 502 : e.status,
        );
      }
    }
  }

  /** Status for kiosk polling; `unknown` while the API is unreachable. */
  async getPayment(id: string): Promise<DevicePayment | { id: string; status: 'unknown' }> {
    try {
      return await this.online(() => this.api.getPayment(id));
    } catch (err) {
      if (isNetworkError(err)) return { id, status: 'unknown' };
      throw err;
    }
  }

  /** Buyer left the QR: cancel now, or later through the outbox when offline. */
  async cancelPayment(id: string): Promise<{ status: string }> {
    try {
      const p = await this.online(() => this.api.cancelPayment(id));
      return { status: p.status };
    } catch (err) {
      if (err instanceof DeviceApiError && err.status === 404) return { status: 'unknown' };
      this.store.enqueue('payment_cancel', { paymentId: id });
      return { status: 'queued' };
    }
  }

  // --- vouchers ---

  syncVouchers(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      const boothId = this.boothId();
      if (!boothId || !this.api.hasToken) return;
      try {
        const list = await this.online(() => this.api.vouchers());
        this.store.replaceVouchers(boothId, list);
      } catch {
        // keep the last list (offline)
      }
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  async redeemVoucher(input: {
    code: string;
    session: SessionInfo;
    amount: number;
  }): Promise<VoucherOutcome> {
    const code = normalizeVoucherCode(input.code);
    const boothId = this.boothId();
    if (!code || !boothId || boothId !== input.session.boothId)
      return { result: 'invalid', offline: false };
    const codeHash = hashVoucherCode(boothId, code);
    this.store.ensureSession(input.session);
    const usedAt = new Date().toISOString();
    const session = {
      id: input.session.id,
      code: input.session.code,
      startedAt: input.session.startedAt,
    };

    // Online: the API is authoritative (another device of the booth may have used it).
    if (this.telemetry.isOnline !== false && this.api.hasToken) {
      try {
        const r = await this.online(() =>
          this.api.redeemVoucher({
            codeHash,
            session,
            amount: input.amount,
            usedAt,
            offline: false,
          }),
        );
        if (r.result === 'ok') {
          this.store.useVoucher(boothId, codeHash, session.id, usedAt, true);
          this.store.setSessionPayment(session.id, { method: 'voucher', offline: false });
        }
        return { ...r, offline: false };
      } catch (err) {
        // Unreachable / server error: fall back to the local list.
        if (err instanceof DeviceApiError && err.status < 500) throw err;
      }
    }

    const v = this.store.voucher(boothId, codeHash);
    if (!v) return { result: 'invalid', offline: true };
    if (v.remote_used_at || (v.used_at && v.used_session_id !== session.id)) {
      return { result: 'used', usedSessionCode: null, offline: true };
    }
    if (v.expires_at && Date.parse(v.expires_at) < Date.now())
      return { result: 'expired', offline: true };
    if (v.value_type === 'amount' && v.value < input.amount)
      return { result: 'insufficient', offline: true };
    if (!this.store.useVoucher(boothId, codeHash, session.id, usedAt, false)) {
      return { result: 'used', usedSessionCode: null, offline: true };
    }
    this.store.setSessionPayment(session.id, { method: 'voucher', offline: true });
    this.store.enqueue('voucher_use', {
      codeHash,
      session,
      amount: input.amount,
      usedAt,
      offline: true,
    });
    this.event('voucher_offline', `Voucher dipakai offline untuk sesi ${session.code}`, 'info');
    return { result: 'ok', offline: true };
  }

  private delivered(rows: OutboxRow[]) {
    for (const row of rows) {
      if (row.kind !== 'voucher_use') continue;
      const p = JSON.parse(row.payload) as { codeHash: string };
      const boothId = this.boothId();
      if (boothId) this.store.markVoucherSynced(boothId, p.codeHash);
    }
  }

  // --- cash ---

  /** Operator approves cash with the booth admin PIN (verified here, not only in the kiosk). */
  async approveCash(input: { pin: string; session: SessionInfo; amount: number }) {
    const s = this.config.current;
    if (s.status !== 'ready') throw new MoneyError('no_config', 'Config booth belum siap', 409);
    if (Date.now() < this.pin.lockedUntil) {
      throw new MoneyError('pin_locked', 'Terlalu banyak PIN salah. Coba lagi sebentar lagi.', 429);
    }
    if (!s.config.admin.pinHash)
      throw new MoneyError('pin_not_set', 'PIN admin belum diatur di Studio', 409);
    if (!(await verifyAdminPin(input.pin, s.config.admin.pinHash))) {
      const failures = this.pin.failures + 1;
      this.pin =
        failures >= PIN_MAX_FAILURES
          ? { failures: 0, lockedUntil: Date.now() + PIN_LOCK_MS }
          : { failures, lockedUntil: 0 };
      this.event('cash_pin_rejected', 'PIN salah saat persetujuan tunai', 'warn');
      throw new MoneyError('wrong_pin', 'PIN salah', 403);
    }
    this.pin = { failures: 0, lockedUntil: 0 };
    const offline = this.telemetry.isOnline === false;
    const id = createId();
    const approvedAt = new Date().toISOString();
    this.store.ensureSession(input.session);
    this.store.addCashApproval({
      id,
      sessionId: input.session.id,
      amount: input.amount,
      approvedAt,
      offline,
    });
    this.store.setSessionPayment(input.session.id, { method: 'cash', offline });
    this.store.enqueue(
      'cash_approval',
      {
        session: {
          id: input.session.id,
          code: input.session.code,
          startedAt: input.session.startedAt,
        },
        amount: input.amount,
        approvedAt,
        offline,
      },
      id,
    );
    this.event(
      'cash_approved',
      `Tunai Rp${input.amount} disetujui untuk sesi ${input.session.code}`,
      'info',
    );
    void this.telemetry.flush();
    return { id, approvedAt, offline };
  }
}

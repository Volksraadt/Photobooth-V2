/**
 * In-process "payment changed" signals per device, pushed on `/device/stream` as `payment`.
 * The webhook is received by this API process, so no LISTEN/NOTIFY is needed while the API runs
 * as one instance (docs/decisions.md F4). Payload carries ids/status only.
 */
export type PaymentSignal = { paymentId: string; status: string };

export class DeviceSignals {
  private readonly listeners = new Map<string, Set<(s: PaymentSignal) => void>>();

  subscribe(deviceId: string, listener: (s: PaymentSignal) => void): () => void {
    let set = this.listeners.get(deviceId);
    if (!set) this.listeners.set(deviceId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(deviceId);
    };
  }

  emit(deviceId: string | null, signal: PaymentSignal): void {
    if (!deviceId) return;
    for (const l of [...(this.listeners.get(deviceId) ?? [])]) l(signal);
  }
}

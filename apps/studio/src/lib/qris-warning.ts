import 'server-only';
import type { BoothConfig } from '@pb/schema';
import { apiFetch } from '@/lib/api';

/**
 * QRIS enabled but the owner has no active Midtrans credential: the kiosk falls back to
 * voucher/cash (or the Error page when QRIS is the only method). Warn, do not block.
 * Best effort: when the API cannot be asked, say nothing.
 */
export async function qrisSetupWarning(orgId: string, config: BoothConfig): Promise<string | null> {
  if (config.flow.eventMode || !config.flow.paymentMethods.includes('qris')) return null;
  try {
    const res = await apiFetch(`/studio/orgs/${orgId}/integrations/midtrans`);
    if (!res.ok) return null;
    const state = (await res.json()) as { mode: string; credentials: { isActive: boolean }[] };
    if (state.mode === 'mock' || state.credentials.some((c) => c.isActive)) return null;
  } catch {
    return null;
  }
  const others = config.flow.paymentMethods.filter((m) => m !== 'qris');
  return others.length
    ? 'QRIS aktif tetapi Midtrans belum diatur (Integrasi). Booth hanya menerima voucher/tunai sampai Midtrans terhubung.'
    : 'QRIS satu-satunya metode bayar tetapi Midtrans belum diatur (Integrasi). Pembeli tidak bisa membayar sampai Midtrans terhubung.';
}

'use server';

import { getBooth } from '@pb/db';
import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';
import { field } from '@/lib/form';
import { asUser, requireOrg } from '@/lib/org';
import { endOfDayInZone } from '@/lib/timezones';

export type CreatedVoucher = { code: string; formatted: string };

export type VoucherFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'created';
      message: string;
      batchId: string;
      codes: CreatedVoucher[];
      valueLabel: string;
      expiresLabel: string;
    };

const MAX_BATCH = 500;

async function apiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
}

/**
 * Creates single or batch vouchers for one booth. The API generates the codes, stores them hashed
 * (lookup) and encrypted (so they can be shown again here), and returns them once for CSV/print.
 */
export async function createVouchersAction(
  _prev: VoucherFormState,
  form: FormData,
): Promise<VoucherFormState> {
  const { user, org } = await requireOrg();
  if (org.role === 'operator')
    return { status: 'error', message: 'Operator tidak dapat membuat voucher.' };
  const boothId = field(form, 'boothId');
  const count = Math.floor(Number(field(form, 'count') || '1'));
  const valueType = field(form, 'valueType') === 'amount' ? 'amount' : 'full';
  const value = Math.floor(Number(field(form, 'value') || '0'));
  const expiresOn = field(form, 'expiresOn');
  const note = field(form, 'note').trim().slice(0, 120) || null;

  if (!Number.isFinite(count) || count < 1 || count > MAX_BATCH) {
    return { status: 'error', message: `Jumlah voucher 1–${MAX_BATCH}.` };
  }
  if (valueType === 'amount' && (!Number.isFinite(value) || value < 1000)) {
    return { status: 'error', message: 'Nominal voucher minimal Rp1.000.' };
  }

  try {
    const booth = await asUser(user, (tx) => getBooth(tx, boothId));
    if (!booth) return { status: 'error', message: 'Booth tidak ditemukan.' };
    let expiresAt: string | null = null;
    if (expiresOn) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn))
        return { status: 'error', message: 'Tanggal berlaku tidak valid.' };
      expiresAt = endOfDayInZone(expiresOn, booth.booth.timezone).toISOString();
    }
    const res = await apiFetch(`/studio/orgs/${org.id}/booths/${boothId}/vouchers`, {
      method: 'POST',
      body: JSON.stringify({ count, valueType, value, expiresAt, note }),
    });
    if (!res.ok) return { status: 'error', message: await apiError(res, 'Gagal membuat voucher.') };
    const result = (await res.json()) as { batchId: string; codes: CreatedVoucher[] };
    revalidatePath(`/booths/${boothId}/vouchers`);
    return {
      status: 'created',
      message: `${result.codes.length} voucher dibuat. Kode juga tetap bisa dilihat dan disalin di daftar di bawah.`,
      batchId: result.batchId,
      codes: result.codes,
      valueLabel: valueType === 'full' ? 'Gratis 1 sesi' : `Rp${value.toLocaleString('id-ID')}`,
      expiresLabel: expiresOn ? `Berlaku s.d. ${expiresOn}` : 'Tanpa batas waktu',
    };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Gagal membuat voucher.',
    };
  }
}

export type RevealResult =
  | { ok: true; codes: { id: string; code: string | null; formatted: string | null }[] }
  | { ok: false; message: string };

/** Full codes for the owner (`ids` = specific vouchers, null = all of the booth). Audited by the API. */
export async function revealVoucherCodesAction(
  boothId: string,
  ids: string[] | null,
): Promise<RevealResult> {
  const { org } = await requireOrg();
  if (org.role === 'operator')
    return { ok: false, message: 'Hanya owner/manager yang dapat melihat kode voucher.' };
  try {
    const q = ids ? `?ids=${encodeURIComponent(ids.join(','))}` : '';
    const res = await apiFetch(`/studio/orgs/${org.id}/booths/${boothId}/vouchers/codes${q}`);
    if (!res.ok) return { ok: false, message: await apiError(res, 'Gagal mengambil kode.') };
    return { ok: true, ...((await res.json()) as Omit<Extract<RevealResult, { ok: true }>, 'ok'>) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Gagal mengambil kode.' };
  }
}

/** Owner switch: vouchers also work while the booth is offline (device keeps the hash list). */
export async function setVoucherOfflineAction(
  boothId: string,
  enabled: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const { org } = await requireOrg();
  if (org.role === 'operator') return { ok: false, message: 'Operator tidak dapat mengubah ini.' };
  try {
    const res = await apiFetch(`/studio/orgs/${org.id}/booths/${boothId}/voucher-offline`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) return { ok: false, message: await apiError(res, 'Gagal menyimpan.') };
    revalidatePath(`/booths/${boothId}/vouchers`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Gagal menyimpan.' };
  }
}

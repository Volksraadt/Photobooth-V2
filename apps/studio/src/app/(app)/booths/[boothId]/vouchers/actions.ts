'use server';

import { createId } from '@paralleldrive/cuid2';
import { formatVoucherCode, generateVoucherCode, hashVoucherCodeAsync } from '@pb/crypto';
import { getBooth, insertVouchers } from '@pb/db';
import { revalidatePath } from 'next/cache';
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

/**
 * Creates single or batch vouchers for one booth. Codes are generated here, shown once to the
 * owner (CSV / print) and stored only as PBKDF2 hashes (the booth validates them offline).
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
    const result = await asUser(user, async (tx) => {
      const booth = await getBooth(tx, boothId);
      if (!booth) throw new Error('Booth tidak ditemukan.');
      const tz = booth.booth.timezone;
      let expiresAt: Date | null = null;
      if (expiresOn) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new Error('Tanggal berlaku tidak valid.');
        expiresAt = endOfDayInZone(expiresOn, tz);
        if (expiresAt.getTime() < Date.now()) throw new Error('Tanggal berlaku sudah lewat.');
      }
      const unique = new Set<string>();
      while (unique.size < count) unique.add(generateVoucherCode());
      const codes = [...unique];
      const hashes = await Promise.all(codes.map((c) => hashVoucherCodeAsync(boothId, c)));
      const batchId = createId();
      await insertVouchers(tx, {
        orgId: booth.booth.orgId,
        boothId,
        batchId,
        note,
        valueType,
        value: valueType === 'amount' ? value : 0,
        expiresAt,
        codes: codes.map((c, i) => ({ codeHash: hashes[i]!, last4: c.slice(-4) })),
        userId: user.id,
      });
      return { batchId, codes, expiresOn: expiresOn || null };
    });
    revalidatePath(`/booths/${boothId}/vouchers`);
    return {
      status: 'created',
      message: `${result.codes.length} voucher dibuat. Simpan atau cetak kodenya sekarang — kode tidak bisa ditampilkan lagi.`,
      batchId: result.batchId,
      codes: result.codes.map((code) => ({ code, formatted: formatVoucherCode(code) })),
      valueLabel: valueType === 'full' ? 'Gratis 1 sesi' : `Rp${value.toLocaleString('id-ID')}`,
      expiresLabel: result.expiresOn ? `Berlaku s.d. ${result.expiresOn}` : 'Tanpa batas waktu',
    };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Gagal membuat voucher.',
    };
  }
}

'use server';

import { getConfigVersion, PlanLimitError, publishConfig, revokeDevice, saveDraft } from '@pb/db';
import { validateBoothConfig } from '@pb/schema';
import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';
import { field, type FormState } from '@/lib/form';
import { asUser, requireOrg } from '@/lib/org';

async function editor() {
  const ctx = await requireOrg();
  if (ctx.org.role === 'operator') throw new Error('Operator tidak dapat melakukan ini.');
  return ctx;
}

/** Rollback = publish the old version's config as a new version (versions only go up). */
export async function rollbackAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await editor();
  const boothId = field(form, 'boothId');
  const version = Number(field(form, 'version'));
  try {
    const published = await asUser(user, async (tx) => {
      const old = await getConfigVersion(tx, boothId, version);
      if (!old) throw new Error(`Versi ${version} tidak ditemukan.`);
      const valid = validateBoothConfig(old.config);
      if (!valid.success)
        throw new Error(`Versi ${version} tidak valid lagi dan tidak bisa diaktifkan.`);
      const next = await publishConfig(tx, {
        boothId,
        config: valid.config,
        userId: user.id,
        action: 'rollback',
        fromVersion: version,
      });
      // The editor continues from what is live now.
      await saveDraft(tx, {
        boothId,
        config: { ...valid.config, configVersion: next.version },
        userId: user.id,
      });
      return next;
    });
    revalidatePath(`/booths/${boothId}`);
    return {
      status: 'info',
      message: `Versi ${version} diaktifkan kembali sebagai versi ${published.version}.`,
    };
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return { status: 'error', message: `Paket ${err.planName} dibatasi ${err.max} frame.` };
    }
    return { status: 'error', message: err instanceof Error ? err.message : 'Rollback gagal.' };
  }
}

/** Pair a kiosk: the code it shows is claimed through apps/api (pairing codes never reach Studio). */
export async function pairDeviceAction(_prev: FormState, form: FormData): Promise<FormState> {
  await editor();
  const boothId = field(form, 'boothId');
  const code = field(form, 'code').replace(/\s/g, '');
  const name = field(form, 'name').trim() || 'Perangkat booth';
  if (!/^\d{6}$/.test(code)) return { status: 'error', message: 'Kode pairing 6 digit angka.' };
  let res: Response;
  try {
    res = await apiFetch('/studio/pairing/claim', {
      method: 'POST',
      body: JSON.stringify({ code, boothId, name }),
    });
  } catch {
    return { status: 'error', message: 'API tidak dapat dihubungi. Coba lagi.' };
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string; fingerprint?: string };
  if (!res.ok)
    return { status: 'error', message: body.message ?? `Pairing gagal (HTTP ${res.status}).` };
  revalidatePath(`/booths/${boothId}`);
  // The computer name lets the owner spot a wrong device (mistyped code) and revoke it at once.
  const host = body.fingerprint?.replace(/^agent:/, '');
  return {
    status: 'info',
    message: `Perangkat "${name}"${host ? ` (komputer: ${host})` : ''} terpasang. Kiosk akan memuat desain aktif. Jika nama komputer tidak sesuai, cabut perangkat ini di daftar perangkat.`,
  };
}

export async function revokeDeviceAction(form: FormData): Promise<void> {
  const { user } = await editor();
  const boothId = field(form, 'boothId');
  await asUser(user, (tx) => revokeDevice(tx, field(form, 'deviceId'), user.id));
  revalidatePath(`/booths/${boothId}`);
}

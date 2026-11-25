'use server';

import {
  archiveBooth,
  deleteUnusedBooth,
  getBooth,
  getConfigVersion,
  listConfigVersions,
  PlanLimitError,
  publishConfig,
  restoreBooth,
  revokeDevice,
  saveDraft,
} from '@pb/db';
import {
  migrateBoothConfig,
  upgradeBoothConfig,
  validateBoothConfig,
  type BoothConfig,
} from '@pb/schema';

/** Stored configs may be of an older schemaVersion: upgrade before using them. */
const upgraded = (config: unknown): BoothConfig =>
  ((r) => (r.success ? r.config : config) as BoothConfig)(upgradeBoothConfig(config));
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { field, type FormState } from '@/lib/form';
import { asUser, requireOrg } from '@/lib/org';
import { qrisSetupWarning } from '@/lib/qris-warning';

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
      const valid = migrateBoothConfig(old.config);
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

const METHODS = ['qris', 'voucher', 'cash'] as const;

/**
 * Payment options from the booth page (no editor needed). Applied to the live version (published
 * as a new version so the kiosk picks it up) and to the draft, without publishing other unfinished
 * design changes of the draft. A booth that was never published only gets the draft change.
 */
export async function savePaymentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await editor();
  const boothId = field(form, 'boothId');
  const eventMode = field(form, 'eventMode') === 'on';
  const methods = METHODS.filter((m) => form.get(`method-${m}`) === 'on');
  if (!eventMode && methods.length === 0)
    return {
      status: 'error',
      message: 'Pilih minimal satu cara bayar, atau aktifkan mode event (tanpa pembayaran).',
    };
  const apply = <T extends BoothConfig>(c: T): T => ({
    ...c,
    flow: {
      ...c.flow,
      eventMode,
      paymentMethods: methods.length ? [...methods] : c.flow.paymentMethods,
    },
  });

  try {
    const result = await asUser(user, async (tx) => {
      const row = await getBooth(tx, boothId);
      if (!row?.draft) throw new Error('Booth tidak ditemukan.');
      let published: number | null = null;
      let liveConfig: BoothConfig | null = null;
      if (row.booth.activeConfigId) {
        const versions = await listConfigVersions(tx, boothId);
        const active = versions.find((v) => v.id === row.booth.activeConfigId);
        const live = active ? await getConfigVersion(tx, boothId, active.version) : null;
        if (live) {
          const next = validateBoothConfig(apply(upgraded(live.config)));
          if (!next.success) throw new Error(issueText(next.issues));
          const p = await publishConfig(tx, { boothId, config: next.config, userId: user.id });
          published = p.version;
          liveConfig = next.config;
        }
      }
      // The draft keeps its own design edits; only the payment fields change.
      const draft = apply(upgraded(row.draft.config));
      if (published === null) {
        const check = validateBoothConfig(draft);
        if (!check.success) throw new Error(issueText(check.issues));
      }
      await saveDraft(tx, {
        boothId,
        config: published === null ? draft : { ...draft, configVersion: published },
        userId: user.id,
      });
      return { published, config: liveConfig ?? draft };
    });
    revalidatePath(`/booths/${boothId}`);
    const warning = await qrisSetupWarning(org.id, result.config);
    const base =
      result.published !== null
        ? `Pembayaran disimpan dan aktif di booth (versi ${result.published}).`
        : 'Pembayaran disimpan di draft. Booth belum pernah dipublikasikan: publish dari editor agar berlaku.';
    return { status: warning ? 'warning' : 'info', message: warning ? `${base} ${warning}` : base };
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return { status: 'error', message: `Paket ${err.planName} dibatasi ${err.max} frame.` };
    }
    return { status: 'error', message: err instanceof Error ? err.message : 'Gagal menyimpan.' };
  }
}

function issueText(issues: { message: string }[]): string {
  return `Belum bisa disimpan: ${issues
    .slice(0, 3)
    .map((i) => i.message)
    .join(' ')} Tambahkan elemen yang dibutuhkan di editor (halaman Pembayaran).`;
}

/** Archive: stops the booth (devices revoked) and frees a plan slot; data stays. */
export async function archiveBoothAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await editor();
  const boothId = field(form, 'boothId');
  try {
    const r = await asUser(user, (tx) => archiveBooth(tx, { boothId, userId: user.id }));
    revalidatePath(`/booths/${boothId}`);
    revalidatePath('/booths');
    return {
      status: 'info',
      message: `Booth diarsipkan${r.revokedDevices ? ` dan ${r.revokedDevices} perangkat dicabut` : ''}.`,
    };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Gagal mengarsipkan.' };
  }
}

export async function restoreBoothAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await editor();
  const boothId = field(form, 'boothId');
  try {
    await asUser(user, (tx) => restoreBooth(tx, { boothId, userId: user.id }));
    revalidatePath(`/booths/${boothId}`);
    revalidatePath('/booths');
    return {
      status: 'info',
      message: 'Booth dipulihkan. Pasang ulang perangkatnya dengan kode baru.',
    };
  } catch (err) {
    if (err instanceof PlanLimitError)
      return {
        status: 'error',
        message: `Paket ${err.planName} dibatasi ${err.max} booth aktif. Arsipkan booth lain atau upgrade paket.`,
      };
    return { status: 'error', message: err instanceof Error ? err.message : 'Gagal memulihkan.' };
  }
}

/** Permanent delete (only a booth without any session); goes back to the booth list. */
export async function deleteBoothAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await editor();
  const boothId = field(form, 'boothId');
  try {
    await asUser(user, (tx) => deleteUnusedBooth(tx, { boothId, userId: user.id }));
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Gagal menghapus.' };
  }
  revalidatePath('/booths');
  redirect('/booths?deleted=1');
}

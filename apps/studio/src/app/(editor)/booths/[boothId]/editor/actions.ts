'use server';

import { PlanLimitError, publishConfig, saveDraft } from '@pb/db';
import {
  assetUrlPrefixesFromEnv,
  BoothConfigSchema,
  disallowedAssetIds,
  validateBoothConfig,
  type BoothConfig,
  type ValidationIssue,
} from '@pb/schema';
import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';
import { asUser, requireOrg } from '@/lib/org';

/** Assets must come from the platform's storage (the cloud worker fetches them; see T1 audit). */
function foreignAssetMessage(config: BoothConfig): string | null {
  const bad = disallowedAssetIds(config, assetUrlPrefixesFromEnv(process.env));
  return bad.length
    ? `Aset ${bad.join(', ')} bukan dari pustaka aset. Unggah ulang lewat pustaka aset.`
    : null;
}

export type SaveResult = { ok: true; savedAt: string } | { ok: false; message: string };

export type PublishResult =
  | { ok: true; version: number; warning?: string | null }
  | { ok: false; message: string; issues?: ValidationIssue[] };

/**
 * QRIS enabled but the owner has no active Midtrans credential: the kiosk falls back to
 * voucher/cash (or the Error page when QRIS is the only method). Warn, do not block publishing.
 * Best effort: when the API cannot be asked, say nothing.
 */
async function qrisSetupWarning(orgId: string, config: BoothConfig): Promise<string | null> {
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

async function editor() {
  const ctx = await requireOrg();
  if (ctx.org.role === 'operator') throw new Error('Operator tidak dapat mengubah desain.');
  return ctx;
}

/** Autosave. The draft may be semantically invalid while editing, but must keep the config shape. */
export async function saveDraftAction(boothId: string, config: unknown): Promise<SaveResult> {
  try {
    const { user } = await editor();
    const parsed = BoothConfigSchema.safeParse(config);
    if (!parsed.success)
      return { ok: false, message: 'Bentuk config tidak valid; draft tidak disimpan.' };
    if (parsed.data.boothId !== boothId) return { ok: false, message: 'Config milik booth lain.' };
    const foreign = foreignAssetMessage(parsed.data);
    if (foreign) return { ok: false, message: foreign };
    const row = await asUser(user, (tx) =>
      saveDraft(tx, { boothId, config: parsed.data, userId: user.id }),
    );
    return { ok: true, savedAt: row.updatedAt.toISOString() };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Gagal menyimpan.' };
  }
}

/** Validate on the server, save the draft, then publish a new version. */
export async function publishAction(boothId: string, config: unknown): Promise<PublishResult> {
  try {
    const { user, org } = await editor();
    const result = validateBoothConfig(config);
    if (!result.success) {
      return { ok: false, message: 'Desain belum bisa dipublikasikan.', issues: result.issues };
    }
    if (result.config.boothId !== boothId)
      return { ok: false, message: 'Config milik booth lain.' };
    const foreign = foreignAssetMessage(result.config);
    if (foreign) return { ok: false, message: foreign };
    const published = await asUser(user, async (tx) => {
      await saveDraft(tx, { boothId, config: result.config, userId: user.id });
      return publishConfig(tx, { boothId, config: result.config, userId: user.id });
    });
    revalidatePath(`/booths/${boothId}`);
    const warning = await qrisSetupWarning(org.id, result.config);
    return { ok: true, version: published.version, warning };
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return {
        ok: false,
        message: `Paket ${err.planName} dibatasi ${err.max} frame. Nonaktifkan/hapus frame atau upgrade paket.`,
      };
    }
    return { ok: false, message: err instanceof Error ? err.message : 'Gagal mempublikasikan.' };
  }
}

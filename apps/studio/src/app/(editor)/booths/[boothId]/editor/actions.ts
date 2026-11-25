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
import { asUser, requireOrg } from '@/lib/org';
import { qrisSetupWarning } from '@/lib/qris-warning';

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

/** Warnings shown before publishing (the owner confirms; they never block). */
export async function publishPreflightAction(boothId: string, config: unknown): Promise<string[]> {
  try {
    const { org } = await editor();
    const parsed = BoothConfigSchema.safeParse(config);
    if (!parsed.success || parsed.data.boothId !== boothId) return [];
    const qris = await qrisSetupWarning(org.id, parsed.data);
    return qris ? [qris] : [];
  } catch {
    return [];
  }
}

/** Validate on the server, save the draft, then publish a new version. */
export async function publishAction(boothId: string, config: unknown): Promise<PublishResult> {
  try {
    const { user } = await editor();
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
    // QRIS/Midtrans warnings were shown and confirmed before publishing (publishPreflightAction).
    return { ok: true, version: published.version };
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

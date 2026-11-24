'use server';

import { PlanLimitError, publishConfig, saveDraft } from '@pb/db';
import { BoothConfigSchema, validateBoothConfig, type ValidationIssue } from '@pb/schema';
import { revalidatePath } from 'next/cache';
import { asUser, requireOrg } from '@/lib/org';

export type SaveResult = { ok: true; savedAt: string } | { ok: false; message: string };

export type PublishResult =
  { ok: true; version: number } | { ok: false; message: string; issues?: ValidationIssue[] };

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
    const { user } = await editor();
    const result = validateBoothConfig(config);
    if (!result.success) {
      return { ok: false, message: 'Desain belum bisa dipublikasikan.', issues: result.issues };
    }
    if (result.config.boothId !== boothId)
      return { ok: false, message: 'Config milik booth lain.' };
    const published = await asUser(user, async (tx) => {
      await saveDraft(tx, { boothId, config: result.config, userId: user.id });
      return publishConfig(tx, { boothId, config: result.config, userId: user.id });
    });
    revalidatePath(`/booths/${boothId}`);
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

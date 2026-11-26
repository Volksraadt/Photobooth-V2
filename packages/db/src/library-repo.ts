import type { BoothConfig, PhotoSlot } from '@pb/schema';
import { asc, eq } from 'drizzle-orm';
import { boothDrafts, booths, libraryFrames, templates } from './schema';
import type { Db, Tx } from './types';

export type LibraryFrameRow = typeof libraryFrames.$inferSelect;

/**
 * Platform frame library. Owners read published frames through RLS (Tx); platform admins manage
 * the library through the API with the privileged connection (Db); admins are the e-mails in
 * PB_PLATFORM_ADMINS (set in both the API and the Studio deployment).
 */
export async function listLibraryFrames(tx: Tx): Promise<LibraryFrameRow[]> {
  return tx
    .select()
    .from(libraryFrames)
    .where(eq(libraryFrames.isPublished, true))
    .orderBy(asc(libraryFrames.sortOrder), asc(libraryFrames.createdAt));
}

export async function adminListLibraryFrames(db: Db): Promise<LibraryFrameRow[]> {
  return db
    .select()
    .from(libraryFrames)
    .orderBy(asc(libraryFrames.sortOrder), asc(libraryFrames.createdAt));
}

export async function adminInsertLibraryFrame(
  db: Db,
  input: {
    name: string;
    description?: string | null;
    url: string;
    sha256: string;
    bytes: number;
    mimeType: string;
    width?: number | null;
    height?: number | null;
    slots: PhotoSlot[];
    sortOrder?: number;
    isPublished?: boolean;
    createdBy: string;
  },
): Promise<LibraryFrameRow> {
  const [row] = await db.insert(libraryFrames).values(input).returning();
  return row!;
}

export async function adminUpdateLibraryFrame(
  db: Db,
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    slots: PhotoSlot[];
    sortOrder: number;
    isPublished: boolean;
  }>,
): Promise<LibraryFrameRow | null> {
  const [row] = await db
    .update(libraryFrames)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(libraryFrames.id, id))
    .returning();
  return row ?? null;
}

/** Removes the library entry only; booths that already use the overlay keep their copy of the ref. */
export async function adminDeleteLibraryFrame(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(libraryFrames).where(eq(libraryFrames.id, id)).returning();
  return rows.length > 0;
}

// --- Booth templates (platform admin) -------------------------------------------------------

export type AdminTemplateRow = {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const templateSummary = {
  id: templates.id,
  key: templates.key,
  name: templates.name,
  description: templates.description,
  isPublic: templates.isPublic,
  createdAt: templates.createdAt,
  updatedAt: templates.updatedAt,
};

export async function adminListTemplates(db: Db): Promise<AdminTemplateRow[]> {
  return db.select(templateSummary).from(templates).orderBy(asc(templates.name));
}

/** A booth's current draft (any org: platform admin only). */
export async function adminGetBoothDraft(
  db: Db,
  boothId: string,
): Promise<{ name: string; config: unknown } | null> {
  const [row] = await db
    .select({ name: booths.name, config: boothDrafts.config })
    .from(boothDrafts)
    .innerJoin(booths, eq(booths.id, boothDrafts.boothId))
    .where(eq(boothDrafts.boothId, boothId));
  return row ?? null;
}

export async function adminInsertTemplate(
  db: Db,
  input: { name: string; description: string | null; config: BoothConfig; isPublic: boolean },
): Promise<AdminTemplateRow> {
  const [row] = await db.insert(templates).values(input).returning(templateSummary);
  return row!;
}

export async function adminUpdateTemplate(
  db: Db,
  id: string,
  patch: Partial<{ name: string; description: string | null; isPublic: boolean }>,
): Promise<AdminTemplateRow | null> {
  const [row] = await db
    .update(templates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(templates.id, id))
    .returning(templateSummary);
  return row ?? null;
}

/** Only templates saved from booths; built-in ones (with a key) come back on every seed. */
export async function adminDeleteTemplate(
  db: Db,
  id: string,
): Promise<'deleted' | 'builtin' | 'not_found'> {
  const [row] = await db.select({ key: templates.key }).from(templates).where(eq(templates.id, id));
  if (!row) return 'not_found';
  if (row.key) return 'builtin';
  await db.delete(templates).where(eq(templates.id, id));
  return 'deleted';
}

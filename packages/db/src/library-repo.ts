import type { PhotoSlot } from '@pb/schema';
import { asc, eq } from 'drizzle-orm';
import { libraryFrames } from './schema';
import type { Db, Tx } from './types';

export type LibraryFrameRow = typeof libraryFrames.$inferSelect;

/**
 * Platform frame library. Owners read published frames through RLS (Tx); platform admins manage
 * the library through the API with the privileged connection (Db).
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

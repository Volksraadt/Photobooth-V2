import { createId } from '@paralleldrive/cuid2';
import { createDefaultBoothConfig } from '@pb/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { boothDrafts, booths, orgMembers, orgs } from './schema';
import type { Tx } from './types';

/**
 * Studio data access. Every function takes a Tx from withUserContext(), so RLS is
 * the enforcement layer; org_id filters here are for clarity and index use.
 */

export type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'manager' | 'operator';
};

export async function listMyOrgs(tx: Tx): Promise<OrgSummary[]> {
  return tx
    .select({ id: orgs.id, name: orgs.name, slug: orgs.slug, role: orgMembers.role })
    .from(orgs)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, orgs.id), eq(orgMembers.userId, sql`auth.uid()`)),
    )
    .orderBy(asc(orgs.createdAt));
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'org'}-${createId().slice(0, 6)}`;
}

export async function createOrg(
  tx: Tx,
  input: { name: string; timezone?: string },
): Promise<{ id: string; slug: string }> {
  const id = createId();
  const slug = slugify(input.name);
  await tx.execute(
    sql`select app.create_org(${id}, ${createId()}, ${createId()}, ${input.name}, ${slug}, ${input.timezone ?? 'Asia/Jakarta'})`,
  );
  return { id, slug };
}

export async function listBooths(tx: Tx, orgId: string) {
  return tx
    .select({
      id: booths.id,
      name: booths.name,
      status: booths.status,
      timezone: booths.timezone,
      activeConfigId: booths.activeConfigId,
      createdAt: booths.createdAt,
    })
    .from(booths)
    .where(eq(booths.orgId, orgId))
    .orderBy(asc(booths.createdAt));
}

export async function getBooth(tx: Tx, boothId: string) {
  const [row] = await tx
    .select({ booth: booths, draft: boothDrafts })
    .from(booths)
    .leftJoin(boothDrafts, eq(boothDrafts.boothId, booths.id))
    .where(eq(booths.id, boothId));
  return row ?? null;
}

/** Creates the booth and its draft from createDefaultBoothConfig(). */
export async function createBooth(
  tx: Tx,
  input: { orgId: string; name: string; timezone?: string; userId: string },
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('Nama booth wajib diisi');
  const id = createId();
  const timezone = input.timezone ?? 'Asia/Jakarta';
  await tx.insert(booths).values({ id, orgId: input.orgId, name, timezone });
  await tx.insert(boothDrafts).values({
    orgId: input.orgId,
    boothId: id,
    config: createDefaultBoothConfig({ boothId: id, boothName: name, timezone }),
    updatedBy: input.userId,
  });
  return { id };
}

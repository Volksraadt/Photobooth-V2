import { listMyOrgs, withUserContext } from '@pb/db';
import type { Context } from 'hono';
import type { AppEnv } from '../types';

/** The signed-in user's membership of an org (RLS decides what they can see), or a 404 response. */
export async function orgMembership(c: Context<AppEnv>, orgId: string) {
  return withUserContext(c.var.deps.db, c.var.user.userId, async (tx) =>
    (await listMyOrgs(tx)).find((o) => o.id === orgId),
  );
}

/** Owner/manager only (settings, integrations). Returns an error response or null. */
export async function requireOrgEditor(c: Context<AppEnv>, orgId: string) {
  const org = await orgMembership(c, orgId);
  if (!org) return c.json({ error: 'not_found', message: 'Organisasi tidak ditemukan.' }, 404);
  if (org.role === 'operator') {
    return c.json(
      { error: 'forbidden', message: 'Hanya owner/manager yang dapat mengatur integrasi.' },
      403,
    );
  }
  return null;
}

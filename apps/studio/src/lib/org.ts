import 'server-only';
import { getDb, listMyOrgs, withUserContext, type OrgSummary, type Tx } from '@pb/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser, type CurrentUser } from './auth';

export const ORG_COOKIE = 'pb_org';

/** Run DB work as the signed-in user (RLS enforced). */
export async function asUser<T>(user: CurrentUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUserContext(getDb(), user.id, fn);
}

/** Signed-in user + their active org; redirects to /login or /onboarding when missing. */
export async function requireOrg(): Promise<{
  user: CurrentUser;
  org: OrgSummary;
  orgs: OrgSummary[];
}> {
  const user = await requireUser();
  const orgs = await asUser(user, (tx) => listMyOrgs(tx));
  if (orgs.length === 0) redirect('/onboarding');
  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === preferred) ?? orgs[0]!;
  return { user, org, orgs };
}

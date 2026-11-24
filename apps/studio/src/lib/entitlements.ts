import 'server-only';
import { resolveEntitlements, type Entitlements, type PlanFeatures } from '@pb/db';
import type { CurrentUser } from './auth';
import { asUser } from './org';

/** What the signed-in user's org may do now (plan limits + features, grace and downgrade rules). */
export async function getEntitlements(
  user: CurrentUser,
  orgId: string,
): Promise<Entitlements | null> {
  return asUser(user, (tx) => resolveEntitlements(tx, orgId));
}

export function hasFeature(e: Entitlements | null, feature: keyof PlanFeatures): boolean {
  return !!e?.features[feature];
}

/** Platform admins are named in PB_PLATFORM_ADMINS (same variable as apps/api, which enforces it). */
export function isPlatformAdmin(user: CurrentUser): boolean {
  const list = (process.env.PB_PLATFORM_ADMINS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !!user.email && list.includes(user.email.toLowerCase());
}

/** Starter keeps 30 days of recap (PRD §11); other plans are unlimited. */
export function recapDays(e: Entitlements | null): number | null {
  return e?.limits.recapDays ?? null;
}

import { Button } from '@pb/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SubscriptionBanner } from '@/components/subscription-banner';
import { getEntitlements, isPlatformAdmin } from '@/lib/entitlements';
import { requireOrg } from '@/lib/org';
import { logoutAction } from '../login/actions';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, org } = await requireOrg();
  const entitlements = await getEntitlements(user, org.id);
  const manager = org.role !== 'operator';
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-6">
            <Link href="/booths" className="font-semibold">
              Photobooth Studio
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/booths" className="hover:underline">
                Booth
              </Link>
              <Link href="/reports" className="hover:underline" data-testid="nav-reports">
                Rekap
              </Link>
              <Link href="/transactions" className="hover:underline" data-testid="nav-transactions">
                Transaksi
              </Link>
              <Link href="/devices" className="hover:underline" data-testid="nav-devices">
                Perangkat
              </Link>
              <Link href="/integrations" className="hover:underline" data-testid="nav-integrations">
                Integrasi
              </Link>
              <Link href="/billing" className="hover:underline" data-testid="nav-billing">
                Langganan
              </Link>
              {manager && (
                <Link href="/audit" className="hover:underline" data-testid="nav-audit">
                  Log audit
                </Link>
              )}
              {isPlatformAdmin(user) && (
                <Link href="/admin" className="hover:underline" data-testid="nav-admin">
                  Admin
                </Link>
              )}
            </nav>
            <span className="text-sm text-muted-foreground" data-testid="org-name">
              {org.name}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.email}</span>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Keluar
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <SubscriptionBanner entitlements={entitlements} timeZone={org.timezone} />
        {children}
      </main>
    </div>
  );
}

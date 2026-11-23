import { Button } from '@pb/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireOrg } from '@/lib/org';
import { logoutAction } from '../login/actions';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, org } = await requireOrg();
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/booths" className="font-semibold">
              Photobooth Studio
            </Link>
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
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

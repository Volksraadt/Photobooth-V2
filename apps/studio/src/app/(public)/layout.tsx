import Link from 'next/link';
import type { ReactNode } from 'react';
import { operatorName } from '@/lib/public-info';

/** Public pages (no login): home page and privacy policy, also linked from the OAuth consent. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/tentang" className="font-semibold">
            Photobooth Studio
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/privasi" className="hover:underline">
              Kebijakan Privasi
            </Link>
            <Link href="/login" className="hover:underline">
              Masuk
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-xs text-muted-foreground">
        © {new Date().getUTCFullYear()} {operatorName()} ·{' '}
        <Link href="/privasi" className="underline">
          Kebijakan Privasi
        </Link>
      </footer>
    </div>
  );
}

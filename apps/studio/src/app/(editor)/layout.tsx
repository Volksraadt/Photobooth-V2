import type { ReactNode } from 'react';
import { requireOrg } from '@/lib/org';

/** Full-screen editor: no app header. */
export default async function EditorLayout({ children }: { children: ReactNode }) {
  await requireOrg();
  return <div className="h-screen overflow-hidden bg-muted/40">{children}</div>;
}

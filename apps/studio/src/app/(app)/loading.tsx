import { Skeleton } from '@pb/ui';

/** Shown while a Studio page loads its data on the server. */
export default function Loading() {
  return (
    <div className="space-y-8" role="status" aria-label="Memuat halaman">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <div className="space-y-3 rounded-lg border bg-background p-6">
        <Skeleton className="h-5 w-40" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <span className="sr-only">Memuat…</span>
    </div>
  );
}

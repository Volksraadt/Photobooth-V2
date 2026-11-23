import { listBooths } from '@pb/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pb/ui';
import Link from 'next/link';
import { asUser, requireOrg } from '@/lib/org';
import { CreateBoothForm } from './create-booth-form';

export default async function BoothsPage() {
  const { user, org } = await requireOrg();
  const booths = await asUser(user, (tx) => listBooths(tx, org.id));
  const canEdit = org.role !== 'operator';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Booth</h1>
        <p className="text-sm text-muted-foreground">
          Setiap booth punya desain, harga, dan perangkatnya sendiri.
        </p>
      </div>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booth baru</CardTitle>
            <CardDescription>
              Booth dibuat dengan desain default yang bisa Anda ubah di editor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateBoothForm defaultTimezone="Asia/Jakarta" />
          </CardContent>
        </Card>
      )}

      {booths.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          Belum ada booth.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-background" data-testid="booth-list">
          {booths.map((b) => (
            <li key={b.id}>
              <Link
                href={`/booths/${b.id}`}
                className="flex items-center justify-between p-4 hover:bg-muted/50"
              >
                <div>
                  <div className="font-medium">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.timezone}</div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {b.activeConfigId ? 'Sudah dipublikasikan' : 'Draft'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

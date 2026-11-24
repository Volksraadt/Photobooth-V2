import { getOrgPlan, listBooths, listTemplates } from '@pb/db';
import type { BoothConfig } from '@pb/schema';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pb/ui';
import Link from 'next/link';
import { asUser, requireOrg } from '@/lib/org';
import { CreateBoothForm } from './create-booth-form';

export default async function BoothsPage() {
  const { user, org } = await requireOrg();
  const { booths, templates, plan } = await asUser(user, async (tx) => ({
    booths: await listBooths(tx, org.id),
    templates: await listTemplates(tx),
    plan: await getOrgPlan(tx, org.id),
  }));
  const maxBooths = plan?.limits.maxBooths ?? null;
  const atLimit = maxBooths !== null && booths.length >= maxBooths;
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
              Pilih template sebagai titik awal; semua bisa diubah di editor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {atLimit ? (
              <p className="text-sm text-amber-700" data-testid="booth-limit">
                Paket {plan?.name} dibatasi {maxBooths} booth. Upgrade paket untuk menambah booth.
              </p>
            ) : (
              <CreateBoothForm
                defaultTimezone="Asia/Jakarta"
                templates={templates.map((t) => ({ ...t, config: t.config as BoothConfig }))}
              />
            )}
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

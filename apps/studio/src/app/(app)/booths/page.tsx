import {
  deviceConnectivity,
  getOrgPlan,
  getReport,
  listBooths,
  listOrgDevices,
  listRefundCandidates,
  listTemplates,
  listUploadQueue,
} from '@pb/db';
import type { BoothConfig } from '@pb/schema';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pb/ui';
import Link from 'next/link';
import { OrgOverview, type OverviewData } from '@/components/org-overview';
import { nowMs } from '@/lib/format';
import { asUser, requireOrg } from '@/lib/org';
import { addDays, todayIn } from '@/lib/range';
import { CreateBoothForm } from './create-booth-form';

export default async function BoothsPage() {
  const { user, org } = await requireOrg();
  const now = nowMs();
  const today = todayIn(org.timezone, new Date(now));
  const { booths, templates, plan, overview } = await asUser(user, async (tx) => {
    const [booths, templates, plan, todayReport, weekReport, devices, queue, refunds] =
      await Promise.all([
        listBooths(tx, org.id),
        listTemplates(tx),
        getOrgPlan(tx, org.id),
        getReport(tx, { orgId: org.id, from: today, to: today, boothId: null, deviceId: null }),
        getReport(tx, {
          orgId: org.id,
          from: addDays(today, -6),
          to: today,
          boothId: null,
          deviceId: null,
        }),
        listOrgDevices(tx, org.id),
        listUploadQueue(tx, org.id),
        listRefundCandidates(tx, org.id),
      ]);
    const overview: OverviewData = {
      today: { sessions: todayReport.totals.sessions, gross: todayReport.totals.gross },
      week: { sessions: weekReport.totals.sessions, gross: weekReport.totals.gross },
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        boothName: d.boothName,
        connectivity: deviceConnectivity(d, new Date(now)),
        lastHeartbeatAt: d.lastHeartbeatAt,
      })),
      uploads: {
        failed: queue.filter((q) => q.job.status === 'failed').length,
        waiting: queue.filter((q) => q.job.status !== 'failed').length,
      },
      refunds: refunds.length,
      now,
    };
    return { booths, templates, plan, overview };
  });
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

      <OrgOverview data={overview} />

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
    </div>
  );
}

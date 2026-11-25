import { listAuditActions, listAuditLogs } from '@pb/db';
import { Alert, Button, Card, CardContent } from '@pb/ui';
import { redirect } from 'next/navigation';
import { getEntitlements, hasFeature } from '@/lib/entitlements';
import { formatDateTime, nowMs } from '@/lib/format';
import { asUser, requireOrg } from '@/lib/org';

const DAY = 86_400_000;

/** Human text for the actions we log (anything else shows its raw key). */
const ACTION_LABEL: Record<string, string> = {
  'booth.publish': 'Publish desain booth',
  'booth.rollback': 'Rollback desain booth',
  'device.pair': 'Memasangkan perangkat',
  'device.revoke': 'Mencabut perangkat',
  'device.paper_new_roll': 'Roll kertas baru',
  'device.paper_capacity': 'Mengubah kapasitas roll',
  'voucher.create': 'Membuat voucher',
  'cash.approve': 'Persetujuan pembayaran tunai',
  'integration.midtrans.save': 'Mengubah kredensial Midtrans',
  'integration.midtrans.test': 'Tes koneksi Midtrans',
  'integration.drive.connect': 'Menghubungkan Google Drive',
  'integration.drive.disconnect': 'Memutus Google Drive',
  'integration.drive.root_folder': 'Mengubah folder root Drive',
  'subscription.paid': 'Pembayaran langganan diterima',
  'subscription.past_due': 'Langganan lewat jatuh tempo',
  'subscription.downgraded': 'Paket diturunkan ke Starter',
  'subscription.admin_set': 'Paket diubah admin platform',
};

/**
 * Audit log (append-only, see docs/schema.md B.5). Owner/manager. Without the plan feature
 * `auditLog` the last 30 days are shown; with it the full history.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const sp = await searchParams;
  const { user, org } = await requireOrg();
  if (org.role === 'operator') redirect('/booths');
  const ent = await getEntitlements(user, org.id);
  const full = hasFeature(ent, 'auditLog');
  const { logs, actions } = await asUser(user, async (tx) => ({
    logs: await listAuditLogs(tx, {
      orgId: org.id,
      action: sp.action || null,
      since: full ? null : new Date(nowMs() - 30 * DAY),
      limit: full ? 500 : 200,
    }),
    actions: await listAuditActions(tx, org.id),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Log audit</h1>
        <p className="text-sm text-muted-foreground">
          Perubahan desain, kredensial, voucher, pembayaran tunai, perangkat, dan langganan. Catatan
          ini tidak bisa diubah atau dihapus.
        </p>
      </div>
      {!full && (
        <Alert data-testid="audit-limit">
          Paket {ent?.planName} menampilkan 30 hari terakhir. Riwayat lengkap tersedia di paket
          Business.
        </Alert>
      )}
      <form className="flex flex-wrap items-end gap-3 rounded border bg-background p-3 text-sm">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Jenis kejadian</span>
          <select
            name="action"
            defaultValue={sp.action ?? ''}
            className="h-9 rounded-md border bg-background px-2"
          >
            <option value="">Semua</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a] ?? a}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Terapkan</Button>
      </form>
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada catatan.</p>
          ) : (
            <table className="data-table w-full text-sm" data-testid="audit-list">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">Waktu</th>
                  <th>Kejadian</th>
                  <th>Objek</th>
                  <th>Pelaku</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((l) => (
                  <tr key={l.id} className="align-top" data-action={l.action}>
                    <td className="whitespace-nowrap py-1">{formatDateTime(l.at, org.timezone)}</td>
                    <td>{ACTION_LABEL[l.action] ?? l.action}</td>
                    <td className="break-all font-mono text-xs">
                      {l.entity}
                      {l.entityId ? `:${l.entityId.slice(0, 10)}` : ''}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {!l.actorId
                        ? 'sistem / perangkat'
                        : l.actorId === user.id
                          ? 'Anda'
                          : `anggota ${l.actorId.slice(0, 8)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

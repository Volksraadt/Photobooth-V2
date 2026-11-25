import { listBooths, listOrgDevices, listTransactions } from '@pb/db';
import { Alert, Button, Card, CardContent } from '@pb/ui';
import Link from 'next/link';
import { UploadCell } from '@/components/session-upload';
import { getEntitlements, recapDays } from '@/lib/entitlements';
import { formatDateTime, formatDay, idr, METHOD_LABEL } from '@/lib/format';
import { asUser, requireOrg } from '@/lib/org';
import { resolveRange, todayIn } from '@/lib/range';

const PAGE = 50;
const STATUS: Record<string, string> = {
  started: 'dimulai',
  paid: 'lunas',
  capturing: 'berfoto',
  completed: 'selesai',
  abandoned: 'ditinggal',
  failed: 'gagal',
};

type SP = { from?: string; to?: string; booth?: string; device?: string; page?: string };

/** All transactions of the org with upload/print state; times in each booth's own zone. */
export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { user, org } = await requireOrg();
  const ent = await getEntitlements(user, org.id);
  const range = resolveRange(sp, todayIn(org.timezone), recapDays(ent));
  const page = Math.max(1, Math.floor(Number(sp.page ?? '1')) || 1);

  const data = await asUser(user, async (tx) => {
    const [boothList, deviceList] = await Promise.all([
      listBooths(tx, org.id),
      listOrgDevices(tx, org.id),
    ]);
    const boothId = boothList.some((b) => b.id === sp.booth) ? sp.booth! : null;
    const deviceId = deviceList.some((d) => d.id === sp.device) ? sp.device! : null;
    const list = await listTransactions(tx, {
      orgId: org.id,
      from: range.from,
      to: range.to,
      boothId,
      deviceId,
      limit: PAGE,
      offset: (page - 1) * PAGE,
    });
    return { boothList, deviceList, boothId, deviceId, list };
  });
  const { boothList, deviceList, boothId, deviceId, list } = data;
  const pages = Math.max(1, Math.ceil(list.total / PAGE));
  const link = (p: number) => {
    const q = new URLSearchParams({ from: range.from, to: range.to, page: String(p) });
    if (boothId) q.set('booth', boothId);
    if (deviceId) q.set('device', deviceId);
    return `/transactions?${q}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Transaksi</h1>
        <p className="text-sm text-muted-foreground">
          {formatDay(range.from)} – {formatDay(range.to)} · {list.total} sesi. Waktu mengikuti zona
          waktu booth. Sesi dari booth yang offline muncul setelah booth online lagi.
        </p>
      </div>
      {range.clamped && (
        <Alert>
          Paket {ent?.planName} menampilkan {recapDays(ent)} hari terakhir.
        </Alert>
      )}
      <form className="flex flex-wrap items-end gap-3 rounded border bg-background p-3 text-sm">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Dari</span>
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            max={range.today}
            className="h-9 rounded-md border bg-background px-2"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Sampai</span>
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            max={range.today}
            className="h-9 rounded-md border bg-background px-2"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Booth</span>
          <select
            name="booth"
            defaultValue={boothId ?? ''}
            className="h-9 rounded-md border bg-background px-2"
          >
            <option value="">Semua booth</option>
            {boothList.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Perangkat</span>
          <select
            name="device"
            defaultValue={deviceId ?? ''}
            className="h-9 rounded-md border bg-background px-2"
          >
            <option value="">Semua perangkat</option>
            {deviceList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Terapkan</Button>
      </form>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          {list.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada sesi pada rentang ini.</p>
          ) : (
            <table className="data-table w-full text-sm" data-testid="transaction-list">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">Kode</th>
                  <th>Booth</th>
                  <th>Mulai</th>
                  <th>Metode</th>
                  <th className="text-right">Kotor</th>
                  <th className="text-right">Bersih</th>
                  <th>Status</th>
                  <th>Cetak</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.rows.map((s) => (
                  <tr key={s.id} data-testid={`txn-${s.code}`} className="align-top">
                    <td className="py-1 font-mono">
                      <Link href={`/transactions/${s.id}`} className="underline">
                        {s.code}
                      </Link>
                    </td>
                    <td>{s.boothName}</td>
                    <td className="whitespace-nowrap">{formatDateTime(s.startedAt, s.timezone)}</td>
                    <td>
                      {s.paymentMethod ? METHOD_LABEL[s.paymentMethod] : '—'}
                      {s.offline && (
                        <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">
                          offline
                        </span>
                      )}
                    </td>
                    <td className="text-right">{idr(s.grossAmount)}</td>
                    <td className="text-right">{idr(s.netAmount)}</td>
                    <td>{STATUS[s.status] ?? s.status}</td>
                    <td className="whitespace-nowrap">
                      {s.print
                        ? `${s.print.sheets}× ${s.print.status === 'done' ? 'tercetak' : s.print.status}`
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap">
                      <UploadCell
                        session={{
                          id: s.id,
                          code: s.code,
                          status: s.status,
                          filesCompleteAt: null,
                          driveFolderUrl: s.driveFolderUrl,
                        }}
                        jobs={s.jobs}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              {page > 1 ? <Link href={link(page - 1)}>← Sebelumnya</Link> : <span />}
              <span className="text-muted-foreground">
                Halaman {page} dari {pages}
              </span>
              {page < pages ? <Link href={link(page + 1)}>Berikutnya →</Link> : <span />}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import {
  getBooth,
  listBoothSessions,
  listRefundCandidates,
  listUploadJobsForSessions,
} from '@pb/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pb/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatInZone } from '@/lib/timezones';
import { asUser, requireOrg } from '@/lib/org';
import { uploadState } from '@/lib/upload-status';
import { RetryUploadButton } from './retry-button';

const METHOD: Record<string, string> = {
  qris: 'QRIS',
  voucher: 'Voucher',
  cash: 'Tunai',
  free: 'Gratis',
};
const STATUS: Record<string, string> = {
  started: 'dimulai',
  paid: 'lunas',
  capturing: 'berfoto',
  completed: 'selesai',
  abandoned: 'ditinggal',
  failed: 'gagal',
};
const idr = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

/** Transactions of one booth (F4 basics; full sales recap is F6). */
export default async function TransactionsPage({
  params,
}: {
  params: Promise<{ boothId: string }>;
}) {
  const { boothId } = await params;
  const { user, org } = await requireOrg();
  const data = await asUser(user, async (tx) => {
    const row = await getBooth(tx, boothId);
    if (!row) return null;
    const [sessions, refunds] = await Promise.all([
      listBoothSessions(tx, boothId, 100),
      listRefundCandidates(tx, org.id),
    ]);
    const jobs = await listUploadJobsForSessions(
      tx,
      sessions.map((x) => x.id),
    );
    return {
      booth: row.booth,
      sessions,
      jobs,
      refunds: refunds.filter((r) => r.boothId === boothId),
    };
  });
  if (!data) notFound();
  const { booth, sessions, refunds, jobs } = data;
  const tz = booth.timezone;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/booths/${boothId}`} className="text-sm text-muted-foreground hover:underline">
          ← {booth.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Transaksi</h1>
        <p className="text-sm text-muted-foreground">
          100 sesi terakhir. Sesi dari booth yang sedang offline muncul setelah booth online lagi.
        </p>
      </div>

      {refunds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kandidat refund</CardTitle>
            <CardDescription>
              QRIS lunas setelah kedaluwarsa/dibatalkan. Refund manual dari dashboard Midtrans.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded border text-sm" data-testid="booth-refunds">
              {refunds.map((r) => (
                <li key={r.id} className="flex justify-between p-2">
                  <span>
                    Sesi <b>{r.sessionCode}</b> · {idr(r.amount)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.paidAt ? formatInZone(r.paidAt, tz) : ''} · order {r.orderId}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada sesi.</p>
          ) : (
            <table className="w-full text-sm" data-testid="session-list">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">Kode</th>
                  <th>Mulai</th>
                  <th>Metode</th>
                  <th className="text-right">Kotor</th>
                  <th className="text-right">Fee</th>
                  <th className="text-right">Bersih</th>
                  <th>Status</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sessions.map((s) => (
                  <tr key={s.id} data-testid={`session-${s.code}`}>
                    <td className="py-1 font-mono">{s.code}</td>
                    <td>{formatInZone(s.startedAt, tz)}</td>
                    <td>
                      {s.paymentMethod ? METHOD[s.paymentMethod] : '—'}
                      {s.offline && (
                        <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">
                          offline
                        </span>
                      )}
                    </td>
                    <td className="text-right">{idr(s.grossAmount)}</td>
                    <td className="text-right">{idr(s.feeAmount)}</td>
                    <td className="text-right">{idr(s.netAmount)}</td>
                    <td>{STATUS[s.status] ?? s.status}</td>
                    <td data-testid={`upload-${s.code}`}>
                      <UploadCell session={s} jobs={jobs.filter((j) => j.sessionId === s.id)} />
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

function UploadCell({
  session,
  jobs,
}: {
  session: Parameters<typeof uploadState>[0] & { id: string; code: string };
  jobs: Parameters<typeof uploadState>[1];
}) {
  const u = uploadState(session, jobs);
  const tone =
    u.kind === 'done'
      ? 'text-emerald-700'
      : u.kind === 'failed'
        ? 'text-destructive'
        : u.kind === 'retrying'
          ? 'text-amber-700'
          : 'text-muted-foreground';
  return (
    <div className="space-y-1">
      <div className={tone}>
        {u.driveUrl ? (
          <a className="underline" href={u.driveUrl} target="_blank" rel="noreferrer">
            {u.label}
          </a>
        ) : (
          u.label
        )}
      </div>
      {u.detail && <div className="max-w-xs text-xs text-muted-foreground">{u.detail}</div>}
      {u.canRetry && <RetryUploadButton sessionId={session.id} code={session.code} />}
    </div>
  );
}

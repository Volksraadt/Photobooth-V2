import { getBooth, listBoothVouchers } from '@pb/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pb/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatInZone } from '@/lib/timezones';
import { asUser, requireOrg } from '@/lib/org';
import { VoucherForm } from './voucher-form';

const nowMs = () => Date.now();

export default async function VouchersPage({ params }: { params: Promise<{ boothId: string }> }) {
  const { boothId } = await params;
  const { user, org } = await requireOrg();
  const data = await asUser(user, async (tx) => {
    const row = await getBooth(tx, boothId);
    if (!row) return null;
    return { booth: row.booth, vouchers: await listBoothVouchers(tx, boothId), now: nowMs() };
  });
  if (!data) notFound();
  const { booth, vouchers, now } = data;
  const tz = booth.timezone;
  const used = vouchers.filter((v) => v.usedAt).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/booths/${boothId}`} className="text-sm text-muted-foreground hover:underline">
          ← {booth.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Voucher</h1>
        <p className="text-sm text-muted-foreground">
          {vouchers.length} voucher · {used} terpakai · {vouchers.length - used} tersedia
        </p>
      </div>

      {org.role !== 'operator' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buat voucher</CardTitle>
            <CardDescription>
              Kode 12 digit dimasukkan pembeli di halaman Pembayaran. Daftar voucher otomatis
              tersinkron ke perangkat booth.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VoucherForm boothId={boothId} boothName={booth.name} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daftar voucher</CardTitle>
          <CardDescription>
            Kode lengkap hanya ditampilkan saat dibuat; di sini hanya 4 digit terakhir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vouchers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada voucher.</p>
          ) : (
            <table className="w-full text-sm" data-testid="voucher-list">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">Kode</th>
                  <th>Nilai</th>
                  <th>Berlaku</th>
                  <th>Status</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {vouchers.map((v) => (
                  <tr key={v.id} data-testid={`voucher-${v.codeLast4}`}>
                    <td className="py-1 font-mono">····-····-{v.codeLast4}</td>
                    <td>
                      {v.valueType === 'full' ? 'Penuh' : `Rp${v.value.toLocaleString('id-ID')}`}
                    </td>
                    <td>{v.expiresAt ? formatInZone(v.expiresAt, tz) : '—'}</td>
                    <td>
                      {v.usedAt ? (
                        <span>
                          Terpakai sesi <b>{v.usedSessionCode ?? '?'}</b> ·{' '}
                          {formatInZone(v.usedAt, tz)}
                          {v.usedOffline && (
                            <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">
                              offline
                            </span>
                          )}
                        </span>
                      ) : v.expiresAt && v.expiresAt.getTime() < now ? (
                        <span className="text-muted-foreground">kedaluwarsa</span>
                      ) : (
                        <span className="text-emerald-700">tersedia</span>
                      )}
                    </td>
                    <td className="text-muted-foreground">{v.note ?? ''}</td>
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

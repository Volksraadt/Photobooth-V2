import { listRefundCandidates } from '@pb/db';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pb/ui';
import { apiFetch } from '@/lib/api';
import { asUser, requireOrg } from '@/lib/org';
import { MidtransForm, TestConnectionButton, type CredentialView } from './midtrans-forms';

type IntegrationState = {
  mode: 'midtrans' | 'mock';
  encryptionReady: boolean;
  webhookUrl: string | null;
  credentials: CredentialView[];
};

const STATUS_LABEL: Record<CredentialView['status'], string> = {
  untested: 'belum dites',
  ok: 'terhubung',
  failed: 'gagal',
  revoked: 'dicabut',
};

const idr = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

export default async function IntegrationsPage() {
  const { user, org } = await requireOrg();
  const canEdit = org.role !== 'operator';

  let state: IntegrationState | null = null;
  let loadError: string | null = null;
  if (canEdit) {
    try {
      const res = await apiFetch(`/studio/orgs/${org.id}/integrations/midtrans`);
      if (res.ok) state = (await res.json()) as IntegrationState;
      else loadError = `API menolak (HTTP ${res.status}).`;
    } catch {
      loadError = 'API tidak dapat dihubungi.';
    }
  }
  const refunds = await asUser(user, (tx) => listRefundCandidates(tx, org.id));
  const cred = (env: 'sandbox' | 'production') =>
    state?.credentials.find((c) => c.env === env) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrasi</h1>
        <p className="text-sm text-muted-foreground">
          Pembayaran pembeli masuk langsung ke akun Midtrans milik Anda.
        </p>
      </div>

      {!canEdit && <Alert>Hanya owner atau manager yang dapat mengatur integrasi.</Alert>}
      {loadError && <Alert variant="destructive">{loadError}</Alert>}
      {state && !state.encryptionReady && (
        <Alert variant="destructive">
          Server API belum memiliki SECRET_MASTER_KEY, jadi kredensial belum bisa disimpan.
        </Alert>
      )}
      {state?.mode === 'mock' && (
        <Alert>
          Mode pengembangan: API memakai provider tiruan (PB_PAYMENT_PROVIDER=mock). Tidak ada
          transaksi ke Midtrans.
        </Alert>
      )}

      {state && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Midtrans QRIS</CardTitle>
            <CardDescription>Panduan singkat menghubungkan akun Midtrans:</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ol className="list-decimal space-y-1 pl-5 text-sm" data-testid="midtrans-guide">
              <li>
                Daftar / masuk ke dashboard Midtrans (dashboard.midtrans.com). Untuk mencoba, pilih
                lingkungan <b>Sandbox</b> di pojok kiri atas.
              </li>
              <li>
                Buka <b>Settings → Access Keys</b>, salin Merchant ID, Client Key, dan Server Key ke
                formulir di bawah (Sandbox dan Production punya key berbeda).
              </li>
              <li>
                Pastikan metode pembayaran <b>QRIS</b> aktif untuk akun Anda (Settings → Payment
                methods). Untuk Production, QRIS perlu diaktifkan setelah verifikasi bisnis.
              </li>
              <li>
                Di <b>Settings → Payment → Notification URL</b> isikan URL berikut agar status lunas
                langsung sampai ke booth:
                <code
                  className="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs"
                  data-testid="webhook-url"
                >
                  {state.webhookUrl ?? 'Belum diatur: setel PB_PUBLIC_API_URL di server API.'}
                </code>
                API juga mengirim URL ini per transaksi, dan booth tetap mengecek status secara
                berkala bila notifikasi terlambat.
              </li>
              <li>
                Simpan, lalu tekan <b>Tes koneksi</b>. Untuk sandbox, bayar QR dengan simulator QRIS
                Midtrans.
              </li>
            </ol>

            {(['sandbox', 'production'] as const).map((env) => {
              const c = cred(env);
              return (
                <section key={env} className="space-y-3 rounded border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-medium">
                      {env === 'sandbox' ? 'Sandbox (uji coba)' : 'Production (uang sungguhan)'}
                      {c?.isActive && (
                        <span className="ml-2 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">
                          aktif
                        </span>
                      )}
                    </h2>
                    {c && (
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid={`midtrans-status-${env}`}
                      >
                        Status: {STATUS_LABEL[c.status]}
                        {c.lastTestMessage ? ` — ${c.lastTestMessage}` : ''}
                      </span>
                    )}
                  </div>
                  <MidtransForm env={env} credential={c} />
                  {c && <TestConnectionButton env={env} />}
                </section>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kandidat refund</CardTitle>
          <CardDescription>
            Pembayaran QRIS yang lunas setelah kedaluwarsa atau dibatalkan, atau sesi yang sudah
            dibayar dengan cara lain. Uang ada di akun Midtrans Anda; lakukan refund manual dari
            dashboard Midtrans.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {refunds.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada.</p>
          ) : (
            <ul className="divide-y rounded border text-sm" data-testid="refund-list">
              {refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 p-3">
                  <span>
                    Sesi <b>{r.sessionCode}</b> · {idr(r.amount)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Order {r.orderId}
                    {r.providerRef ? ` · Transaksi ${r.providerRef}` : ''}
                    {r.paidAt
                      ? ` · ${r.paidAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

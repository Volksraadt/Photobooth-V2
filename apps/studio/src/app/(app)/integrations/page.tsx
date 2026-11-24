import { listRefundCandidates } from '@pb/db';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pb/ui';
import { apiFetch } from '@/lib/api';
import { asUser, requireOrg } from '@/lib/org';
import {
  ConnectDriveButton,
  DisconnectDriveButton,
  RootFolderForm,
  TestDriveButton,
  type DriveFolderOption,
} from './drive-forms';
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

type DriveState = {
  configured: boolean;
  redirectUri: string | null;
  connection: {
    googleEmail: string;
    status: 'untested' | 'ok' | 'failed' | 'revoked';
    lastError: string | null;
    rootFolderId: string | null;
    rootFolderName: string | null;
    rootFolderUrl: string | null;
  } | null;
};

/** Result of the Google OAuth round trip (`?drive=` set by apps/api's callback). */
const DRIVE_FLASH: Record<string, { error: boolean; text: string }> = {
  connected: { error: false, text: 'Google Drive terhubung.' },
  denied: { error: true, text: 'Izin Google Drive tidak diberikan. Coba hubungkan lagi.' },
  expired: { error: true, text: 'Sesi hubungkan kedaluwarsa. Mulai lagi.' },
  no_refresh_token: {
    error: true,
    text: 'Google tidak memberi izin akses berkelanjutan. Cabut akses aplikasi di myaccount.google.com/permissions lalu hubungkan lagi.',
  },
  scope_missing: {
    error: true,
    text: 'Izin Google Drive yang diberikan tidak lengkap. Hubungkan lagi.',
  },
  not_configured: { error: true, text: 'Server belum dikonfigurasi untuk Google Drive.' },
  error: { error: true, text: 'Gagal menghubungkan Google Drive. Coba lagi.' },
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string }>;
}) {
  const { drive: driveFlash } = await searchParams;
  const { user, org } = await requireOrg();
  const canEdit = org.role !== 'operator';

  let drive: DriveState | null = null;
  let driveFolders: DriveFolderOption[] = [];
  if (canEdit) {
    try {
      const res = await apiFetch(`/studio/orgs/${org.id}/integrations/google-drive`);
      if (res.ok) drive = (await res.json()) as DriveState;
      if (drive?.connection && drive.connection.status !== 'revoked') {
        const f = await apiFetch(`/studio/orgs/${org.id}/integrations/google-drive/folders`);
        if (f.ok) driveFolders = ((await f.json()) as { folders: DriveFolderOption[] }).folders;
      }
    } catch {
      // The Midtrans section below reports the API being down.
    }
  }
  const flash = driveFlash ? DRIVE_FLASH[driveFlash] : undefined;

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

      {canEdit && drive && (
        <Card data-testid="drive-card">
          <CardHeader>
            <CardTitle className="text-base">Google Drive</CardTitle>
            <CardDescription>
              Semua file sesi (foto asli, mirror, filter, strip, GIF, video) diunggah ke Google
              Drive milik Anda. Aplikasi hanya meminta izin <code>drive.file</code>: ia hanya bisa
              mengakses file dan folder yang dibuatnya sendiri, bukan seluruh Drive Anda.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {flash && (
              <Alert variant={flash.error ? 'destructive' : 'default'} data-testid="drive-flash">
                {flash.text}
              </Alert>
            )}
            {!drive.configured && (
              <Alert variant="destructive">
                Server API belum dikonfigurasi untuk Google Drive (GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET, SECRET_MASTER_KEY). Lihat docs/testing/F5-manual.md.
              </Alert>
            )}
            {drive.configured && !drive.connection && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Belum terhubung.</p>
                <ConnectDriveButton reconnect={false} />
              </div>
            )}
            {drive.connection && (
              <div className="space-y-4">
                <div className="text-sm" data-testid="drive-status">
                  <div>
                    Akun: <b>{drive.connection.googleEmail}</b> · Status:{' '}
                    <b>
                      {drive.connection.status === 'ok'
                        ? 'terhubung'
                        : drive.connection.status === 'revoked'
                          ? 'akses dicabut'
                          : drive.connection.status === 'failed'
                            ? 'bermasalah'
                            : 'belum dites'}
                    </b>
                  </div>
                  {drive.connection.lastError && (
                    <p className="mt-1 text-destructive">{drive.connection.lastError}</p>
                  )}
                  <div className="mt-1">
                    Folder root:{' '}
                    {drive.connection.rootFolderUrl ? (
                      <a
                        className="underline"
                        href={drive.connection.rootFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {drive.connection.rootFolderName}
                      </a>
                    ) : (
                      <span className="text-destructive">belum dipilih</span>
                    )}
                    <span className="text-muted-foreground">
                      {' '}
                      → &lt;nama booth&gt; / tanggal / kode sesi / 6 subfolder
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  {drive.connection.status === 'revoked' && <ConnectDriveButton reconnect />}
                  {drive.connection.status !== 'revoked' && <TestDriveButton />}
                  <DisconnectDriveButton />
                </div>
                {drive.connection.status !== 'revoked' && (
                  <RootFolderForm
                    folders={driveFolders}
                    currentId={drive.connection.rootFolderId}
                  />
                )}
              </div>
            )}
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

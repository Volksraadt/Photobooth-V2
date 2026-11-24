import { getBooth, getOrgPlan, listConfigVersions, listDevices } from '@pb/db';
import { validateBoothConfig } from '@pb/schema';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pb/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, requireOrg } from '@/lib/org';
import { revokeDeviceAction } from './actions';
import { PairDeviceForm, RollbackButton } from './booth-forms';
import { PagePreviews } from './page-previews';

const ONLINE_MS = 2 * 60 * 1000;
const nowMs = () => Date.now();

function formatTime(d: Date | null, timezone: string): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(d);
}

export default async function BoothPage({ params }: { params: Promise<{ boothId: string }> }) {
  const { boothId } = await params;
  const { user, org } = await requireOrg();
  // RLS returns null for booths outside the user's orgs.
  const data = await asUser(user, async (tx) => {
    const row = await getBooth(tx, boothId);
    if (!row) return null;
    const [versions, devices, plan] = await Promise.all([
      listConfigVersions(tx, boothId),
      listDevices(tx, boothId),
      getOrgPlan(tx, row.booth.orgId),
    ]);
    return { row, versions, devices, plan, now: nowMs() };
  });
  if (!data) notFound();
  const { row, versions, devices, plan, now } = data;
  const canEdit = org.role !== 'operator';
  const tz = row.booth.timezone;

  const config = row.draft?.config;
  const validation = config ? validateBoothConfig(config) : null;
  const active = versions.find((v) => v.id === row.booth.activeConfigId);
  const activeDevices = devices.filter((d) => !d.revokedAt);
  const maxDevices = plan?.limits.maxDevicesPerBooth ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/booths" className="text-sm text-muted-foreground hover:underline">
            ← Semua booth
          </Link>
          <h1 className="mt-2 text-2xl font-semibold" data-testid="booth-name">
            {row.booth.name}
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="booth-status">
            {tz} · {active ? `Versi aktif v${active.version}` : 'Belum dipublikasikan'}
          </p>
        </div>
        <Button asChild>
          <Link href={`/booths/${boothId}/editor`} data-testid="open-editor">
            {canEdit ? 'Buka editor' : 'Lihat desain'}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Draft desain</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!config ? (
            <Alert variant="destructive">Draft tidak ditemukan.</Alert>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <Stat
                  label="Artboard"
                  value={`${config.artboard.width}×${config.artboard.height}`}
                />
                <Stat label="Halaman" value={Object.keys(config.pages).length} />
                <Stat label="Frame" value={config.frames.length} />
                <Stat label="Filter" value={config.filters.length} />
              </dl>
              {validation?.success ? (
                <Alert variant="success" data-testid="draft-valid">
                  Draft valid dan siap dipublikasikan.
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <ul className="list-disc pl-4">
                    {validation?.issues.map((i) => (
                      <li key={`${i.path}-${i.code}`}>{i.message}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {validation?.success && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pratinjau halaman</CardTitle>
          </CardHeader>
          <CardContent>
            <PagePreviews config={validation.config} boothName={row.booth.name} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Perangkat</CardTitle>
          <CardDescription>
            Buka Kiosk di laptop booth; Kiosk yang belum terpasang menampilkan kode 6 digit.
            {maxDevices !== null &&
              ` Paket ${plan?.name}: maksimal ${maxDevices} perangkat per booth.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit && (maxDevices === null || activeDevices.length < maxDevices) ? (
            <PairDeviceForm boothId={boothId} />
          ) : (
            canEdit && (
              <p className="text-sm text-amber-700" data-testid="device-limit">
                Batas perangkat paket {plan?.name} tercapai. Cabut perangkat lama atau upgrade
                paket.
              </p>
            )
          )}
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada perangkat.</p>
          ) : (
            <ul className="divide-y rounded border text-sm" data-testid="device-list">
              {devices.map((d) => {
                const online =
                  !d.revokedAt &&
                  d.lastHeartbeatAt &&
                  now - d.lastHeartbeatAt.getTime() < ONLINE_MS;
                return (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3"
                    data-testid={`device-${d.id}`}
                  >
                    <div>
                      <div className="font-medium">
                        {d.name}{' '}
                        <span className={online ? 'text-emerald-600' : 'text-muted-foreground'}>
                          {d.revokedAt ? '· dicabut' : online ? '· online' : '· offline'}
                        </span>
                      </div>
                      <div
                        className="text-xs text-muted-foreground"
                        data-testid="device-config-version"
                      >
                        Config terpasang: {d.lastConfigVersion ? `v${d.lastConfigVersion}` : '—'} ·
                        Heartbeat: {formatTime(d.lastHeartbeatAt, tz)}
                      </div>
                    </div>
                    {canEdit && !d.revokedAt && (
                      <form action={revokeDeviceAction}>
                        <input type="hidden" name="boothId" value={boothId} />
                        <input type="hidden" name="deviceId" value={d.id} />
                        <Button type="submit" size="sm" variant="ghost">
                          Cabut
                        </Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat versi</CardTitle>
          <CardDescription>
            Setiap publish membuat versi baru yang tidak bisa diubah.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada versi yang dipublikasikan.</p>
          ) : (
            <ul className="divide-y rounded border text-sm" data-testid="version-list">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-2 p-3"
                  data-testid={`version-${v.version}`}
                >
                  <div>
                    <span className="font-medium">v{v.version}</span>{' '}
                    {v.id === row.booth.activeConfigId && (
                      <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">
                        aktif
                      </span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {formatTime(v.publishedAt, tz)}
                    </div>
                  </div>
                  {canEdit && v.id !== row.booth.activeConfigId && (
                    <RollbackButton boothId={boothId} version={v.version} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

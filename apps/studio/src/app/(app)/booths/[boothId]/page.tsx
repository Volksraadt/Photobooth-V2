import { getBooth } from '@pb/db';
import { validateBoothConfig } from '@pb/schema';
import { Alert, Card, CardContent, CardHeader, CardTitle } from '@pb/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, requireOrg } from '@/lib/org';

export default async function BoothPage({ params }: { params: Promise<{ boothId: string }> }) {
  const { boothId } = await params;
  const { user } = await requireOrg();
  // RLS returns null for booths outside the user's orgs.
  const row = await asUser(user, (tx) => getBooth(tx, boothId));
  if (!row) notFound();

  const config = row.draft?.config;
  const validation = config ? validateBoothConfig(config) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/booths" className="text-sm text-muted-foreground hover:underline">
          ← Semua booth
        </Link>
        <h1 className="mt-2 text-2xl font-semibold" data-testid="booth-name">
          {row.booth.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {row.booth.timezone} ·{' '}
          {row.booth.activeConfigId ? 'Sudah dipublikasikan' : 'Belum dipublikasikan'}
        </p>
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
              <p className="text-xs text-muted-foreground">
                Editor desain tersedia di fase berikutnya (F2).
              </p>
            </>
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

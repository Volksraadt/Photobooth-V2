import { getBooth, getOrgPlan, listAssets, listLibraryFrames } from '@pb/db';
import { PAGE_TYPES, upgradeBoothConfig, type BoothConfig, type PageType } from '@pb/schema';
import { notFound } from 'next/navigation';
import { EditorShell } from '@/editor/editor-shell';
import { toAssetItem } from '@/lib/assets';
import { asUser, requireOrg } from '@/lib/org';
import { publishAction, publishPreflightAction, saveDraftAction } from './actions';

export const metadata = { title: 'Editor booth' };

const PANELS = ['design', 'frames', 'filters', 'settings'] as const;

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ boothId: string }>;
  searchParams: Promise<{ page?: string; panel?: string }>;
}) {
  const { boothId } = await params;
  const query = await searchParams;
  const page = PAGE_TYPES.find((p): p is PageType => p === query.page);
  const panel = PANELS.find((p) => p === query.panel);
  const { user, org } = await requireOrg();
  const data = await asUser(user, async (tx) => {
    const row = await getBooth(tx, boothId);
    if (!row?.draft) return null;
    const [assets, plan, library] = await Promise.all([
      listAssets(tx, row.booth.orgId),
      getOrgPlan(tx, row.booth.orgId),
      listLibraryFrames(tx),
    ]);
    return { row, assets, plan, library };
  });
  if (!data) notFound();
  // Upgrade old shapes WITHOUT validating: a draft may be semantically invalid while editing, and
  // falling back to the raw (old schemaVersion) draft made every later save/publish fail.
  const upgraded = upgradeBoothConfig(data.row.draft!.config);
  const config = (upgraded.success ? upgraded.config : data.row.draft!.config) as BoothConfig;

  return (
    <EditorShell
      initialConfig={config}
      boothId={boothId}
      boothName={data.row.booth.name}
      canEdit={org.role !== 'operator'}
      assets={data.assets.map(toAssetItem)}
      maxFrames={data.plan?.limits.maxFrames ?? null}
      libraryFrames={data.library.map((f) => ({
        id: f.id,
        name: f.name,
        url: f.url,
        sha256: f.sha256,
        bytes: f.bytes,
        slots: f.slots,
      }))}
      saveDraft={saveDraftAction}
      publish={publishAction}
      preflight={publishPreflightAction}
      initialUi={{
        ...(page ? { panel: 'design' as const, target: { kind: 'page' as const, page } } : {}),
        ...(panel ? { panel } : {}),
      }}
    />
  );
}

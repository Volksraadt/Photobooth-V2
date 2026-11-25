import { getBooth, getOrgPlan, listAssets } from '@pb/db';
import { migrateBoothConfig, PAGE_TYPES, type PageType } from '@pb/schema';
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
    const [assets, plan] = await Promise.all([
      listAssets(tx, row.booth.orgId),
      getOrgPlan(tx, row.booth.orgId),
    ]);
    return { row, assets, plan };
  });
  if (!data) notFound();
  const migrated = migrateBoothConfig(data.row.draft!.config);
  // Drafts may be semantically invalid while editing; migrate only fixes old shapes.
  const config = migrated.success ? migrated.config : data.row.draft!.config;

  return (
    <EditorShell
      initialConfig={config}
      boothId={boothId}
      boothName={data.row.booth.name}
      canEdit={org.role !== 'operator'}
      assets={data.assets.map(toAssetItem)}
      maxFrames={data.plan?.limits.maxFrames ?? null}
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

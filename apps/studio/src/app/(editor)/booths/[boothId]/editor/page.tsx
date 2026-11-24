import { getBooth, getOrgPlan, listAssets } from '@pb/db';
import { migrateBoothConfig } from '@pb/schema';
import { notFound } from 'next/navigation';
import { EditorShell } from '@/editor/editor-shell';
import { toAssetItem } from '@/lib/assets';
import { asUser, requireOrg } from '@/lib/org';
import { publishAction, saveDraftAction } from './actions';

export const metadata = { title: 'Editor booth' };

export default async function EditorPage({ params }: { params: Promise<{ boothId: string }> }) {
  const { boothId } = await params;
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
    />
  );
}

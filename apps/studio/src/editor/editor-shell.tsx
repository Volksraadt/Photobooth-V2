'use client';

import { validateBoothConfig, type BoothConfig, type ValidationIssue } from '@pb/schema';
import { cn } from '@pb/ui';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAutosave, type SaveDraftFn, type SaveStatus } from './autosave';
import { Canvas, clampZoom } from './canvas';
import {
  EditorEnvContext,
  EditorStoreContext,
  useEditor,
  useEnv,
  useStore,
  type AssetItem,
  type EditorEnv,
} from './editor-context';
import { IconButton } from './fields';
import { FiltersView } from './filters-view';
import { PAGE_LABEL } from './labels';
import { PreviewDialog } from './preview-dialog';
import { PropertiesPanel } from './properties-panel';
import { SettingsView } from './settings-view';
import { useShortcuts } from './shortcuts';
import { AddElementMenu, FramesList, LayersPanel, PagesList, SlidesBar } from './sidebar';
import { EditorStore, type EditorPanel } from './store';
import { issueElementId, useValidation, type IssueGroups } from './validation';

export type PublishFn = (
  boothId: string,
  config: BoothConfig,
) => Promise<
  | { ok: true; version: number; warning?: string | null }
  | { ok: false; message: string; issues?: ValidationIssue[] }
>;

export function EditorShell(props: {
  initialConfig: BoothConfig;
  boothId: string;
  boothName: string;
  canEdit: boolean;
  assets: AssetItem[];
  maxFrames: number | null;
  saveDraft: SaveDraftFn;
  publish: PublishFn;
}) {
  const [store] = useState(() => new EditorStore(props.initialConfig));
  const [assets, setAssets] = useState(props.assets);
  const addAsset = useCallback(
    (a: AssetItem) => setAssets((list) => (list.some((x) => x.id === a.id) ? list : [a, ...list])),
    [],
  );
  const env = useMemo<EditorEnv>(
    () => ({
      boothId: props.boothId,
      boothName: props.boothName,
      canEdit: props.canEdit,
      assets,
      addAsset,
      maxFrames: props.maxFrames,
    }),
    [props.boothId, props.boothName, props.canEdit, assets, addAsset, props.maxFrames],
  );

  useEffect(() => {
    // Test/debug hook (e2e reads the document and history through it).
    (window as unknown as { __pbEditor?: EditorStore }).__pbEditor = store;
  }, [store]);

  return (
    <EditorStoreContext.Provider value={store}>
      <EditorEnvContext.Provider value={env}>
        <EditorLayout saveDraft={props.saveDraft} publish={props.publish} />
      </EditorEnvContext.Provider>
    </EditorStoreContext.Provider>
  );
}

function EditorLayout({ saveDraft, publish }: { saveDraft: SaveDraftFn; publish: PublishFn }) {
  const store = useStore();
  const env = useEnv();
  const panel = useEditor((s) => s.ui.panel);
  const target = useEditor((s) => s.ui.target);
  const issues = useValidation();
  const { status, flush } = useAutosave(store, env.boothId, saveDraft, env.canEdit);
  const canvasPanel = panel === 'design' || panel === 'frames';
  useShortcuts(store, env.canEdit && canvasPanel);
  const [preview, setPreview] = useState<BoothConfig | null>(null);

  const setPanel = (p: EditorPanel) => {
    const { doc, ui } = store.getState();
    if (p === 'frames' && ui.target.kind !== 'frame') {
      const first = [...doc.frames].sort((a, b) => a.sortOrder - b.sortOrder)[0];
      store.setUi({
        panel: p,
        selection: [],
        ...(first ? { target: { kind: 'frame', frameId: first.id } } : {}),
      });
    } else if (p === 'design' && ui.target.kind === 'frame') {
      store.setUi({ panel: p, selection: [], target: { kind: 'page', page: 'cover' } });
    } else {
      store.setUi({ panel: p });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        status={status}
        issues={issues}
        flush={flush}
        publish={publish}
        onPreview={() => setPreview(store.getState().doc)}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r bg-background">
          <nav className="grid grid-cols-4 border-b text-[11px]" data-testid="panel-tabs">
            {(
              [
                ['design', 'Desain'],
                ['frames', 'Frame'],
                ['filters', 'Filter'],
                ['settings', 'Atur'],
              ] as const
            ).map(([p, label]) => (
              <button
                key={p}
                type="button"
                data-testid={`tab-${p}`}
                onClick={() => setPanel(p)}
                className={cn(
                  'py-2 hover:bg-accent',
                  panel === p && 'border-b-2 border-primary font-semibold',
                )}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-auto">
            {panel === 'design' && (
              <>
                <PagesList issues={issues} />
                {target.kind === 'page' && target.page === 'tutorial' && <SlidesBar />}
                {env.canEdit && (
                  <div className="border-b p-3">
                    <AddElementMenu />
                  </div>
                )}
                <LayersPanel />
              </>
            )}
            {panel === 'frames' && (
              <>
                <FramesList issues={issues} />
                {target.kind === 'frame' && env.canEdit && (
                  <div className="border-b p-3">
                    <AddElementMenu />
                  </div>
                )}
                {target.kind === 'frame' && <LayersPanel />}
              </>
            )}
            {(panel === 'filters' || panel === 'settings') && (
              <p className="p-3 text-xs text-muted-foreground">
                {panel === 'filters'
                  ? 'Atur filter yang bisa dipilih pembeli di halaman Review.'
                  : 'Alur, harga, output, dan PIN admin booth.'}
              </p>
            )}
          </div>
        </aside>
        <main className="relative min-w-0 flex-1">
          {canvasPanel && <Canvas />}
          {panel === 'filters' && <FiltersView />}
          {panel === 'settings' && <SettingsView />}
        </main>
        {canvasPanel && (
          <aside
            className="w-72 shrink-0 overflow-auto border-l bg-background"
            data-testid="properties-panel"
          >
            <fieldset disabled={!env.canEdit}>
              <PropertiesPanel />
            </fieldset>
          </aside>
        )}
      </div>
      {preview && (
        <PreviewDialog
          config={preview}
          boothName={env.boothName}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function SaveBadge({ status }: { status: SaveStatus }) {
  const text = {
    saved: 'Tersimpan',
    dirty: 'Belum tersimpan',
    saving: 'Menyimpan…',
    error: `Gagal menyimpan${status.message ? `: ${status.message}` : ''}`,
  }[status.state];
  return (
    <span
      data-testid="save-status"
      data-state={status.state}
      className={cn(
        'text-xs',
        status.state === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {text}
    </span>
  );
}

function Toolbar({
  status,
  issues,
  flush,
  publish,
  onPreview,
}: {
  status: SaveStatus;
  issues: IssueGroups;
  flush: () => Promise<boolean>;
  publish: PublishFn;
  onPreview: () => void;
}) {
  const store = useStore();
  const env = useEnv();
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const undoLabel = useEditor((s) => s.undoLabel);
  const redoLabel = useEditor((s) => s.redoLabel);
  const zoom = useEditor((s) => s.ui.zoom);
  const snap = useEditor((s) => s.ui.snapToGrid);
  const [showIssues, setShowIssues] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<
    | { kind: 'ok'; version: number; warning?: string | null }
    | { kind: 'error'; message: string; issues?: ValidationIssue[] }
    | null
  >(null);

  const doPublish = async () => {
    setResult(null);
    const doc = store.getState().doc;
    const local = validateBoothConfig(doc);
    if (!local.success) {
      setResult({
        kind: 'error',
        message: 'Perbaiki masalah berikut sebelum publish.',
        issues: local.issues,
      });
      return;
    }
    setPublishing(true);
    await flush();
    const res = await publish(env.boothId, doc);
    setPublishing(false);
    setResult(
      res.ok
        ? { kind: 'ok', version: res.version, warning: res.warning ?? null }
        : { kind: 'error', message: res.message, issues: res.issues },
    );
  };

  const count = issues.all.length;
  return (
    <header className="relative flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <Link
        href={`/booths/${env.boothId}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ←
      </Link>
      <span className="max-w-48 truncate text-sm font-semibold">{env.boothName}</span>
      <div className="mx-2 h-6 w-px bg-border" />
      <IconButton
        title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Undo'}
        testId="undo"
        disabled={!canUndo}
        onClick={() => store.undo()}
      >
        ↶
      </IconButton>
      <IconButton
        title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Shift+Z)` : 'Redo'}
        testId="redo"
        disabled={!canRedo}
        onClick={() => store.redo()}
      >
        ↷
      </IconButton>
      <div className="mx-2 h-6 w-px bg-border" />
      <IconButton title="Perkecil" onClick={() => store.setUi({ zoom: clampZoom(zoom / 1.2) })}>
        −
      </IconButton>
      <span className="w-12 text-center text-xs tabular-nums" data-testid="zoom-level">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton title="Perbesar" onClick={() => store.setUi({ zoom: clampZoom(zoom * 1.2) })}>
        +
      </IconButton>
      <IconButton
        title="Pas layar (Ctrl+0)"
        testId="zoom-fit"
        onClick={() => window.dispatchEvent(new Event('pb-editor-fit'))}
      >
        Fit
      </IconButton>
      <IconButton title="100% (Ctrl+1)" testId="zoom-100" onClick={() => store.setUi({ zoom: 1 })}>
        1:1
      </IconButton>
      <IconButton
        title="Snap ke grid"
        active={snap}
        testId="snap-grid"
        onClick={() => store.setUi({ snapToGrid: !snap })}
      >
        Grid
      </IconButton>
      <div className="ml-auto flex items-center gap-3">
        <SaveBadge status={status} />
        <button
          type="button"
          data-testid="issues-button"
          onClick={() => setShowIssues((s) => !s)}
          className={cn(
            'rounded px-2 py-1 text-xs',
            count ? 'bg-destructive/10 text-destructive' : 'text-emerald-700',
          )}
        >
          {count ? `${count} masalah` : 'Valid'}
        </button>
        <button
          type="button"
          data-testid="preview-button"
          className="h-8 rounded border px-3 text-xs hover:bg-accent"
          onClick={onPreview}
        >
          Pratinjau
        </button>
        {env.canEdit && (
          <button
            type="button"
            data-testid="publish-button"
            disabled={publishing}
            className="h-8 rounded bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60"
            onClick={doPublish}
          >
            {publishing ? 'Mempublikasikan…' : 'Publish'}
          </button>
        )}
      </div>
      {(showIssues || result) && (
        <div
          className="absolute right-3 top-12 z-30 w-96 rounded-md border bg-background p-3 text-xs shadow-lg"
          data-testid="publish-result"
        >
          {result?.kind === 'ok' && (
            <p className="mb-2 text-emerald-700" data-testid="publish-ok">
              Versi {result.version} dipublikasikan. Perangkat booth akan memperbarui tampilan.
            </p>
          )}
          {result?.kind === 'ok' && result.warning && (
            <p className="mb-2 text-amber-700" data-testid="publish-warning">
              {result.warning}
            </p>
          )}
          {result?.kind === 'error' && (
            <p className="mb-2 font-medium text-destructive">{result.message}</p>
          )}
          <IssueList
            issues={result?.kind === 'error' && result.issues ? result.issues : issues.all}
          />
          <button
            type="button"
            className="mt-2 text-muted-foreground underline"
            onClick={() => {
              setShowIssues(false);
              setResult(null);
            }}
          >
            Tutup
          </button>
        </div>
      )}
    </header>
  );
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  const store = useStore();
  if (issues.length === 0) return <p className="text-muted-foreground">Tidak ada masalah.</p>;
  return (
    <ul className="max-h-72 space-y-1 overflow-auto" data-testid="issue-list">
      {issues.map((i) => {
        const page = /^pages\.(\w+)/.exec(i.path)?.[1] as keyof typeof PAGE_LABEL | undefined;
        return (
          <li key={`${i.path}:${i.code}`}>
            <button
              type="button"
              className="text-left hover:underline"
              onClick={() => {
                const doc = store.getState().doc;
                const hit = issueElementId(doc, i);
                if (page) {
                  store.setUi({
                    panel: 'design',
                    target: { kind: 'page', page },
                    selection: hit ? [hit.id] : [],
                  });
                }
              }}
            >
              {page && <span className="mr-1 rounded bg-muted px-1">{PAGE_LABEL[page]}</span>}
              {i.message}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

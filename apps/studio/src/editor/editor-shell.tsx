'use client';

import { validateBoothConfig, type BoothConfig, type ValidationIssue } from '@pb/schema';
import { Button, cn } from '@pb/ui';
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
  type LibraryFrameItem,
} from './editor-context';
import {
  ArrowLeftIcon,
  AlertIcon,
  CheckIcon,
  CloseIcon,
  EyeIcon,
  FitIcon,
  GridIcon,
  MinusIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
} from '@/components/icons';
import { IconButton } from './fields';
import { FiltersView } from './filters-view';
import { PAGE_LABEL } from './labels';
import { PreviewDialog } from './preview-dialog';
import { PropertiesPanel } from './properties-panel';
import { SettingsView } from './settings-view';
import { useShortcuts } from './shortcuts';
import { AddElementMenu, FramesList, LayersPanel, PagesList, SlidesBar } from './sidebar';
import { EditorStore, type EditorPanel, type UiState } from './store';
import { issueElementId, useValidation, type IssueGroups } from './validation';

export type PublishFn = (
  boothId: string,
  config: BoothConfig,
) => Promise<
  | { ok: true; version: number; warning?: string | null }
  | { ok: false; message: string; issues?: ValidationIssue[] }
>;

/** Non-blocking warnings the owner should see before publishing (e.g. QRIS without Midtrans). */
export type PublishPreflightFn = (boothId: string, config: BoothConfig) => Promise<string[]>;

const NO_LIBRARY: LibraryFrameItem[] = [];

export function EditorShell(props: {
  initialConfig: BoothConfig;
  boothId: string;
  boothName: string;
  canEdit: boolean;
  assets: AssetItem[];
  maxFrames: number | null;
  libraryFrames?: LibraryFrameItem[];
  saveDraft: SaveDraftFn;
  publish: PublishFn;
  preflight: PublishPreflightFn;
  /** Opening state, e.g. from `?page=review` links on the booth page. */
  initialUi?: Partial<UiState>;
}) {
  const [store] = useState(() => new EditorStore(props.initialConfig, { ui: props.initialUi }));
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
      libraryFrames: props.libraryFrames ?? NO_LIBRARY,
    }),
    [
      props.boothId,
      props.boothName,
      props.canEdit,
      assets,
      addAsset,
      props.maxFrames,
      props.libraryFrames,
    ],
  );

  useEffect(() => {
    // Test/debug hook (e2e reads the document and history through it).
    (window as unknown as { __pbEditor?: EditorStore }).__pbEditor = store;
  }, [store]);

  return (
    <EditorStoreContext.Provider value={store}>
      <EditorEnvContext.Provider value={env}>
        <EditorLayout
          saveDraft={props.saveDraft}
          publish={props.publish}
          preflight={props.preflight}
        />
      </EditorEnvContext.Provider>
    </EditorStoreContext.Provider>
  );
}

function EditorLayout({
  saveDraft,
  publish,
  preflight,
}: {
  saveDraft: SaveDraftFn;
  publish: PublishFn;
  preflight: PublishPreflightFn;
}) {
  const store = useStore();
  const env = useEnv();
  const panel = useEditor((s) => s.ui.panel);
  const target = useEditor((s) => s.ui.target);
  const issues = useValidation();
  const { status, flush } = useAutosave(store, env.boothId, saveDraft, env.canEdit);
  const canvasPanel = panel === 'design' || panel === 'frames';
  useShortcuts(store, env.canEdit && canvasPanel);
  const [preview, setPreview] = useState<BoothConfig | null>(null);
  // Below lg the properties panel is a drawer over the canvas, so the canvas keeps usable width.
  const [propsOpen, setPropsOpen] = useState(false);

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
        preflight={preflight}
        onPreview={() => setPreview(store.getState().doc)}
        propsToggle={
          canvasPanel ? { open: propsOpen, toggle: () => setPropsOpen((o) => !o) } : null
        }
      />
      <div className={cn('relative flex min-h-0 flex-1', !canvasPanel && 'max-lg:flex-col')}>
        <aside
          className={cn(
            'flex shrink-0 flex-col bg-background',
            canvasPanel ? 'w-52 border-r lg:w-60' : 'border-b lg:w-60 lg:border-b-0 lg:border-r',
          )}
        >
          <nav
            className="grid grid-cols-4 border-b text-xs"
            role="tablist"
            aria-label="Panel editor"
            data-testid="panel-tabs"
          >
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
                role="tab"
                aria-selected={panel === p}
                data-testid={`tab-${p}`}
                onClick={() => setPanel(p)}
                className={cn(
                  'relative py-2.5 font-medium transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  panel === p
                    ? 'text-foreground after:bg-primary'
                    : 'text-muted-foreground after:bg-transparent hover:text-foreground',
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
              <p className="p-3 text-xs text-muted-foreground max-lg:hidden">
                {panel === 'filters'
                  ? 'Atur filter yang bisa dipilih pembeli di halaman Review.'
                  : 'Alur, harga, output, dan PIN admin booth.'}
              </p>
            )}
          </div>
        </aside>
        <main className="relative min-h-0 min-w-0 flex-1">
          {canvasPanel && <Canvas />}
          {panel === 'filters' && <FiltersView />}
          {panel === 'settings' && <SettingsView />}
        </main>
        {canvasPanel && (
          <aside
            className={cn(
              'w-72 shrink-0 overflow-auto border-l bg-background',
              'max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-xl',
              !propsOpen && 'max-lg:hidden',
            )}
            data-testid="properties-panel"
          >
            <div className="flex items-center justify-between border-b px-3 py-2 lg:hidden">
              <span className="text-xs font-semibold">Properti</span>
              <IconButton title="Tutup panel properti" onClick={() => setPropsOpen(false)}>
                <CloseIcon className="size-4" />
              </IconButton>
            </div>
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
        'inline-flex items-center gap-1.5 text-xs',
        status.state === 'error' ? 'text-destructive' : 'text-muted-foreground',
        // Narrow toolbar: only show the badge when there is something to report.
        status.state === 'saved' && 'max-lg:sr-only',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          status.state === 'saved' && 'bg-success',
          status.state === 'dirty' && 'bg-warning',
          status.state === 'saving' && 'animate-pulse bg-muted-foreground',
          status.state === 'error' && 'bg-destructive',
        )}
      />
      {text}
    </span>
  );
}

function Toolbar({
  status,
  issues,
  flush,
  publish,
  preflight,
  onPreview,
  propsToggle,
}: {
  status: SaveStatus;
  issues: IssueGroups;
  flush: () => Promise<boolean>;
  publish: PublishFn;
  preflight: PublishPreflightFn;
  onPreview: () => void;
  propsToggle: { open: boolean; toggle: () => void } | null;
}) {
  const hasSelection = useEditor((s) => s.ui.selection.length > 0);
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
    | { kind: 'confirm'; warnings: string[] }
    | null
  >(null);

  /** Validate locally, then show warnings first: publishing is immutable, so ask before, not after. */
  const doPublish = async (confirmed = false) => {
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
    if (!confirmed) {
      const warnings = await preflight(env.boothId, doc).catch(() => []);
      if (warnings.length) {
        setPublishing(false);
        setResult({ kind: 'confirm', warnings });
        return;
      }
    }
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
    <header className="relative flex h-14 shrink-0 items-center gap-1.5 border-b bg-background px-3 lg:gap-2">
      <Link
        href={`/booths/${env.boothId}`}
        aria-label="Kembali ke halaman booth"
        title="Kembali ke halaman booth"
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
      </Link>
      <span
        className="min-w-[3rem] max-w-24 shrink truncate text-sm font-semibold lg:max-w-48"
        title={env.boothName}
      >
        {env.boothName}
      </span>
      <div className="mx-1 h-6 w-px bg-border lg:mx-2" />
      <IconButton
        title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Undo'}
        testId="undo"
        disabled={!canUndo}
        onClick={() => store.undo()}
      >
        <UndoIcon className="size-4" />
      </IconButton>
      <IconButton
        title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Shift+Z)` : 'Redo'}
        testId="redo"
        disabled={!canRedo}
        onClick={() => store.redo()}
      >
        <RedoIcon className="size-4" />
      </IconButton>
      <div className="mx-1 h-6 w-px bg-border lg:mx-2" />
      <IconButton title="Perkecil" onClick={() => store.setUi({ zoom: clampZoom(zoom / 1.2) })}>
        <MinusIcon className="size-4" />
      </IconButton>
      <span className="w-12 text-center text-xs tabular-nums" data-testid="zoom-level">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton title="Perbesar" onClick={() => store.setUi({ zoom: clampZoom(zoom * 1.2) })}>
        <PlusIcon className="size-4" />
      </IconButton>
      <IconButton
        title="Pas layar (Ctrl+0)"
        testId="zoom-fit"
        onClick={() => window.dispatchEvent(new Event('pb-editor-fit'))}
      >
        <FitIcon className="size-4" />
      </IconButton>
      <span className="max-md:hidden">
        <IconButton
          title="100% (Ctrl+1)"
          testId="zoom-100"
          onClick={() => store.setUi({ zoom: 1 })}
        >
          1:1
        </IconButton>
      </span>
      <span className="max-md:hidden">
        <IconButton
          title="Snap ke grid"
          active={snap}
          testId="snap-grid"
          onClick={() => store.setUi({ snapToGrid: !snap })}
        >
          <GridIcon className="size-4" />
        </IconButton>
      </span>
      <div className="ml-auto flex items-center gap-2 lg:gap-3">
        <SaveBadge status={status} />
        {propsToggle && (
          <button
            type="button"
            data-testid="properties-toggle"
            aria-pressed={propsToggle.open}
            onClick={propsToggle.toggle}
            className={cn(
              'relative h-8 rounded-md border border-input px-2.5 text-xs font-medium shadow-xs hover:bg-accent lg:hidden',
              propsToggle.open && 'bg-accent',
            )}
          >
            Properti
            {hasSelection && !propsToggle.open && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary" />
            )}
          </button>
        )}
        <button
          type="button"
          data-testid="issues-button"
          aria-expanded={showIssues}
          onClick={() => setShowIssues((s) => !s)}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
            count
              ? 'border-destructive/20 bg-destructive-soft text-destructive hover:bg-destructive/15'
              : 'border-success/20 bg-success-soft text-success hover:bg-success/15',
          )}
        >
          {count ? <AlertIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
          {count ? `${count} masalah` : 'Valid'}
        </button>
        <Button
          type="button"
          variant="outline"
          data-testid="preview-button"
          className="h-8 px-3 text-xs"
          onClick={onPreview}
        >
          <EyeIcon className="max-sm:hidden" />
          Pratinjau
        </Button>
        {env.canEdit && (
          <Button
            type="button"
            data-testid="publish-button"
            loading={publishing}
            className="h-8 px-3.5 text-xs"
            onClick={() => void doPublish()}
          >
            {publishing ? 'Mempublikasikan…' : 'Publish'}
          </Button>
        )}
      </div>
      {(showIssues || result) && (
        <div
          role="dialog"
          aria-label="Hasil pemeriksaan dan publish"
          className="absolute right-3 top-14 z-30 w-96 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-background p-4 text-xs shadow-md"
          data-testid="publish-result"
        >
          {result?.kind === 'confirm' && (
            <div data-testid="publish-confirm">
              <p className="mb-2 font-medium">Periksa sebelum publish:</p>
              <ul className="mb-3 list-disc space-y-1 pl-4 text-warning">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  data-testid="publish-confirm-go"
                  className="h-8 px-3 text-xs"
                  onClick={() => void doPublish(true)}
                >
                  Tetap publish
                </Button>
                <Button asChild variant="outline" className="h-8 px-3 text-xs">
                  <Link href="/integrations">Buka Integrasi</Link>
                </Button>
              </div>
            </div>
          )}
          {result?.kind === 'ok' && (
            <p className="mb-2 text-success" data-testid="publish-ok">
              Versi {result.version} dipublikasikan. Perangkat booth akan memperbarui tampilan.
            </p>
          )}
          {result?.kind === 'ok' && result.warning && (
            <p className="mb-2 text-warning" data-testid="publish-warning">
              {result.warning}
            </p>
          )}
          {result?.kind === 'error' && (
            <p className="mb-2 font-medium text-destructive">{result.message}</p>
          )}
          {/* After a publish or a confirm prompt the draft is valid: no "no problems" line. */}
          {(result === null || result.kind === 'error') && (
            <IssueList
              issues={result?.kind === 'error' && result.issues ? result.issues : issues.all}
            />
          )}
          <button
            type="button"
            className="mt-3 font-medium text-muted-foreground hover:text-foreground"
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
              {page && (
                <span className="mr-1 rounded bg-muted px-1.5 py-0.5 font-medium">
                  {PAGE_LABEL[page]}
                </span>
              )}
              {page ? i.message.replace(/^Halaman [^›]+› /, '') : i.message}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

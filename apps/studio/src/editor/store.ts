import type { BoothConfig, Element, PageType } from '@pb/schema';
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';

enablePatches();

/** What the canvas edits. Tutorial slides are a sub-target of the tutorial page (ui.slideId). */
export type EditTarget = { kind: 'page'; page: PageType } | { kind: 'frame'; frameId: string };

export type EditorPanel = 'design' | 'frames' | 'filters' | 'settings';

export type UiState = {
  target: EditTarget;
  /** Tutorial only: slide shown and receiving new static elements. */
  slideId: string | null;
  /** Element ids; in frame mode slots are `slot:<index>`. */
  selection: string[];
  zoom: number;
  pan: { x: number; y: number };
  panel: EditorPanel;
  snapToGrid: boolean;
  gridSize: number;
  /** Copied elements (deep copies, original ids). */
  clipboard: Element[] | null;
};

export type HistoryEntry = {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  selectionBefore: string[];
  selectionAfter: string[];
  coalesceKey?: string;
  at: number;
};

export type EditorState = {
  doc: BoothConfig;
  ui: UiState;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** Increments on every document change (autosave, validation). */
  revision: number;
};

export const HISTORY_LIMIT = 200;
const COALESCE_MS = 600;

export type ApplyOptions = {
  /** Consecutive edits with the same key within 600 ms become one undo step. */
  coalesceKey?: string;
  /** Selection after the change (e.g. newly added elements). Defaults to the current one. */
  selectAfter?: string[];
};

export function defaultUi(doc: BoothConfig): UiState {
  return {
    target: { kind: 'page', page: 'cover' },
    slideId: doc.pages.tutorial.slides?.[0]?.id ?? null,
    selection: [],
    zoom: 0.5,
    pan: { x: 40, y: 40 },
    panel: 'design',
    snapToGrid: true,
    gridSize: 20,
    clipboard: null,
  };
}

/**
 * Editor document + UI state. Every document change goes through apply() (Immer patches),
 * which is what makes undo/redo cover all operations.
 */
export class EditorStore {
  private state: EditorState;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private now: () => number;

  constructor(doc: BoothConfig, opts: { ui?: Partial<UiState>; now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.state = {
      doc,
      ui: { ...defaultUi(doc), ...opts.ui },
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      revision: 0,
    };
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(next: Partial<EditorState>) {
    this.state = {
      ...this.state,
      ...next,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoLabel: this.past.at(-1)?.label ?? null,
      redoLabel: this.future.at(-1)?.label ?? null,
    };
    for (const l of [...this.listeners]) l();
  }

  /** Applies a document change as one undoable step. Returns false when nothing changed. */
  apply(
    label: string,
    recipe: (draft: Draft<BoothConfig>) => void,
    opts: ApplyOptions = {},
  ): boolean {
    const [doc, patches, inversePatches] = produceWithPatches(this.state.doc, recipe);
    if (patches.length === 0) {
      if (opts.selectAfter) this.setUi({ selection: opts.selectAfter });
      return false;
    }
    const selectionBefore = this.state.ui.selection;
    const selectionAfter = opts.selectAfter ?? selectionBefore;
    const at = this.now();
    const last = this.past.at(-1);
    if (
      opts.coalesceKey &&
      last?.coalesceKey === opts.coalesceKey &&
      at - last.at < COALESCE_MS &&
      this.future.length === 0
    ) {
      last.patches = [...last.patches, ...patches];
      last.inversePatches = [...inversePatches, ...last.inversePatches];
      last.selectionAfter = selectionAfter;
      last.at = at;
    } else {
      this.past.push({
        label,
        patches,
        inversePatches,
        selectionBefore,
        selectionAfter,
        coalesceKey: opts.coalesceKey,
        at,
      });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.future = [];
    this.emit({
      doc,
      revision: this.state.revision + 1,
      ui: { ...this.state.ui, selection: selectionAfter },
    });
    return true;
  }

  undo(): boolean {
    const entry = this.past.pop();
    if (!entry) return false;
    this.future.push(entry);
    this.emit({
      doc: applyPatches(this.state.doc, entry.inversePatches),
      revision: this.state.revision + 1,
      ui: { ...this.state.ui, selection: entry.selectionBefore },
    });
    return true;
  }

  redo(): boolean {
    const entry = this.future.pop();
    if (!entry) return false;
    this.past.push(entry);
    this.emit({
      doc: applyPatches(this.state.doc, entry.patches),
      revision: this.state.revision + 1,
      ui: { ...this.state.ui, selection: entry.selectionAfter },
    });
    return true;
  }

  /** Breaks coalescing so the next change starts a new undo step. */
  sealHistory(): void {
    const last = this.past.at(-1);
    if (last) last.coalesceKey = undefined;
  }

  setUi(patch: Partial<UiState> | ((ui: UiState) => Partial<UiState>)): void {
    const next = typeof patch === 'function' ? patch(this.state.ui) : patch;
    this.emit({ ui: { ...this.state.ui, ...next } });
  }

  /** Replaces the document without history (load from server / rollback into draft). */
  reset(doc: BoothConfig): void {
    this.past = [];
    this.future = [];
    this.emit({
      doc,
      revision: this.state.revision + 1,
      ui: { ...defaultUi(doc), ...this.pickUi() },
    });
  }

  private pickUi(): Partial<UiState> {
    const { zoom, pan, panel, snapToGrid, gridSize } = this.state.ui;
    return { zoom, pan, panel, snapToGrid, gridSize };
  }

  historySize(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length };
  }
}

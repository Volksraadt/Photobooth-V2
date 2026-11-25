'use client';

import type { BoothConfig, PhotoSlot } from '@pb/schema';
import type { Draft } from 'immer';
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import type { EditCtx } from './operations';
import type { ApplyOptions, EditorState, EditorStore } from './store';

export type AssetItem = {
  id: string;
  kind: 'image' | 'video' | 'font' | 'audio';
  url: string;
  sha256: string;
  bytes: number;
  width: number | null;
  height: number | null;
  name: string;
};

/** A frame from the platform frame library (Admin → Pustaka frame). */
export type LibraryFrameItem = {
  id: string;
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  slots: PhotoSlot[];
};

/** Asset id a library frame's overlay gets inside a booth config. */
export const libraryAssetId = (frameId: string) => `lib-${frameId}`;

export type EditorEnv = {
  boothId: string;
  boothName: string;
  canEdit: boolean;
  /** Org asset library (uploaded files). */
  assets: AssetItem[];
  addAsset: (asset: AssetItem) => void;
  /** Plan frame limit (null = unlimited). */
  maxFrames: number | null;
  /** Published platform library frames. */
  libraryFrames: LibraryFrameItem[];
};

export const EditorStoreContext = createContext<EditorStore | null>(null);
export const EditorEnvContext = createContext<EditorEnv | null>(null);

export function useStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error('useStore outside the editor');
  return store;
}

export function useEnv(): EditorEnv {
  const env = useContext(EditorEnvContext);
  if (!env) throw new Error('useEnv outside the editor');
  return env;
}

/** Subscribe to a slice of editor state; re-renders only when the slice changes (Object.is). */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  const store = useStore();
  // Selectors must return existing references (or primitives), never fresh objects.
  const get = () => selector(store.getState());
  return useSyncExternalStore(store.subscribe, get, get);
}

export function useCtx(): EditCtx {
  const target = useEditor((s) => s.ui.target);
  const slideId = useEditor((s) => s.ui.slideId);
  return useMemo(() => ({ target, slideId }), [target, slideId]);
}

/** Shorthand for `store.apply` bound to the current edit context. */
export function useApply() {
  const store = useStore();
  return useCallback(
    (label: string, recipe: (d: Draft<BoothConfig>, ctx: EditCtx) => void, opts?: ApplyOptions) => {
      const { target, slideId } = store.getState().ui;
      return store.apply(label, (d) => recipe(d, { target, slideId }), opts);
    },
    [store],
  );
}

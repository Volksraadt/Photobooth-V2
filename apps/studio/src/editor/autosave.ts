'use client';

import type { BoothConfig } from '@pb/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorStore } from './store';

export type SaveStatus = {
  state: 'saved' | 'dirty' | 'saving' | 'error';
  message?: string;
  savedAt?: string;
};

export type SaveDraftFn = (
  boothId: string,
  config: BoothConfig,
) => Promise<{ ok: true; savedAt: string } | { ok: false; message: string }>;

const DEBOUNCE_MS = 1000;

/** Saves the draft 1 s after the last change; `flush()` saves immediately (before publish). */
export function useAutosave(
  store: EditorStore,
  boothId: string,
  save: SaveDraftFn,
  enabled: boolean,
) {
  const [status, setStatus] = useState<SaveStatus>({ state: 'saved' });
  const savedRevision = useRef(store.getState().revision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await inFlight.current;
    const { doc, revision } = store.getState();
    if (revision === savedRevision.current) return true;
    setStatus({ state: 'saving' });
    const run = save(boothId, doc)
      .then((res) => {
        if (res.ok) {
          savedRevision.current = revision;
          const dirty = store.getState().revision !== revision;
          setStatus({ state: dirty ? 'dirty' : 'saved', savedAt: res.savedAt });
          return true;
        }
        setStatus({ state: 'error', message: res.message });
        return false;
      })
      .catch((err: unknown) => {
        setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
        return false;
      });
    inFlight.current = run;
    const ok = await run;
    inFlight.current = null;
    return ok;
  }, [store, boothId, save]);

  useEffect(() => {
    if (!enabled) return;
    return store.subscribe(() => {
      if (store.getState().revision === savedRevision.current) return;
      setStatus((s) => (s.state === 'saving' ? s : { state: 'dirty' }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    });
  }, [store, enabled, flush]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (store.getState().revision !== savedRevision.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [store]);

  return { status, flush };
}

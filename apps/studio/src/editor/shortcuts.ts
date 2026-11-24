'use client';

import { useEffect } from 'react';
import { clampZoom } from './canvas';
import {
  deleteElements,
  duplicateElements,
  elementsOf,
  groupElements,
  nudge,
  pasteElements,
  reorder,
  selectedElements,
  ungroupElements,
} from './operations';
import type { EditorStore } from './store';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)
  );
};

/** Figma-like shortcuts. Only on the design/frame canvas, never while typing in a field. */
export function useShortcuts(store: EditorStore, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const { ui, doc } = store.getState();
      if (ui.panel === 'filters' || ui.panel === 'settings') return;
      const ctx = { target: ui.target, slideId: ui.slideId };
      const sel = ui.selection;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const handled = () => e.preventDefault();

      if (mod && key === 'z') {
        handled();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && key === 'y') {
        handled();
        store.redo();
        return;
      }
      if (mod && key === 'a') {
        handled();
        store.setUi({
          selection: elementsOf(doc, ctx)
            .filter((el) => !el.locked && el.visible)
            .map((el) => el.id),
        });
        return;
      }
      if (mod && (key === 'c' || key === 'x')) {
        const els = selectedElements(doc, ctx, sel);
        if (!els.length) return;
        handled();
        store.setUi({ clipboard: JSON.parse(JSON.stringify(els)) });
        if (key === 'x')
          store.apply('Potong', (d) => deleteElements(d, ctx, sel), { selectAfter: [] });
        return;
      }
      if (mod && key === 'v') {
        if (!ui.clipboard?.length) return;
        handled();
        let added: string[] = [];
        store.apply('Tempel', (d) => {
          added = pasteElements(d, ctx, ui.clipboard!);
        });
        store.setUi({ selection: added });
        return;
      }
      if (mod && key === 'd') {
        handled();
        let added: string[] = [];
        store.apply('Duplikat', (d) => {
          added = duplicateElements(d, ctx, sel);
        });
        store.setUi({ selection: added });
        return;
      }
      if (mod && key === 'g') {
        handled();
        if (e.shiftKey) store.apply('Ungroup', (d) => ungroupElements(d, ctx, sel));
        else
          store.apply(
            'Group',
            (d) =>
              void groupElements(
                d,
                ctx,
                sel.filter((s) => !s.startsWith('slot:')),
              ),
          );
        return;
      }
      if (mod && (e.key === ']' || e.key === '[')) {
        handled();
        const mode =
          e.key === ']' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward';
        store.apply('Urutan layer', (d) => reorder(d, ctx, sel, mode));
        return;
      }
      if (mod && (e.key === '0' || e.key === '1')) {
        handled();
        if (e.key === '0') window.dispatchEvent(new Event('pb-editor-fit'));
        else store.setUi({ zoom: 1 });
        return;
      }
      if (mod && (e.key === '=' || e.key === '+' || e.key === '-')) {
        handled();
        store.setUi({ zoom: clampZoom(ui.zoom * (e.key === '-' ? 1 / 1.2 : 1.2)) });
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        handled();
        store.apply('Hapus', (d) => deleteElements(d, ctx, sel), { selectAfter: [] });
        return;
      }
      if (e.key === 'Escape') {
        store.setUi({ selection: [] });
        return;
      }
      if (e.key.startsWith('Arrow') && sel.length) {
        handled();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        store.apply('Geser', (d) => nudge(d, ctx, sel, dx, dy), {
          coalesceKey: `nudge:${sel.join(',')}`,
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, enabled]);
}

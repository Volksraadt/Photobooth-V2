import { createDefaultBoothConfig, type BoothConfig, type Element } from '@pb/schema';
import { describe, expect, it } from 'vitest';
import { createElement } from './element-factory';
import {
  addElements,
  addSlot,
  align,
  deleteElements,
  distribute,
  duplicateElements,
  elementsOf,
  expandGroups,
  groupElements,
  moveToIndex,
  nudge,
  pasteElements,
  reorder,
  selectedElements,
  setFlag,
  setGeometry,
  shiftSlotOrder,
  ungroupElements,
  updateElement,
  type EditCtx,
} from './operations';
import { EditorStore, HISTORY_LIMIT } from './store';

let n = 0;
const fresh = () => createDefaultBoothConfig({ boothId: 'b', idFactory: () => `id-${++n}` });
const capture: EditCtx = { target: { kind: 'page', page: 'capture' }, slideId: null };

function setup() {
  let t = 0;
  const original = fresh();
  const store = new EditorStore(original, { now: () => (t += 1000) });
  const ids = (doc: BoothConfig) => doc.pages.capture.elements.map((e) => e.id);
  const camera = original.pages.capture.elements.find((e) => e.type === 'camera-view')!;
  const slots = original.pages.capture.elements.filter((e) => e.type === 'photo-slot');
  return { store, original, ids, camera, slots };
}

/** Every operation must be fully undoable and redoable. */
function roundTrip(store: EditorStore, original: BoothConfig) {
  const changed = store.getState().doc;
  expect(changed).not.toEqual(original);
  while (store.undo());
  expect(store.getState().doc).toEqual(original);
  while (store.redo());
  expect(store.getState().doc).toEqual(changed);
}

describe('EditorStore', () => {
  it('apply/undo/redo with selection restore', () => {
    const { store, camera } = setup();
    store.setUi({ selection: [camera.id] });
    store.apply('Geser', (d) => setGeometry(d, capture, [{ id: camera.id, x: 300, y: 120 }]), {
      selectAfter: [],
    });
    expect(store.getState().doc.pages.capture.elements[0]).toMatchObject({ x: 300, y: 120 });
    expect(store.getState().undoLabel).toBe('Geser');
    store.undo();
    expect(store.getState().doc.pages.capture.elements[0]).toMatchObject({ x: 80, y: 80 });
    expect(store.getState().ui.selection).toEqual([camera.id]);
    store.redo();
    expect(store.getState().ui.selection).toEqual([]);
  });

  it('ignores no-op changes and clears redo on a new change', () => {
    const { store, camera } = setup();
    expect(store.apply('noop', () => {})).toBe(false);
    store.apply('a', (d) => setGeometry(d, capture, [{ id: camera.id, x: 1 }]));
    store.undo();
    expect(store.getState().canRedo).toBe(true);
    store.apply('b', (d) => setGeometry(d, capture, [{ id: camera.id, x: 2 }]));
    expect(store.getState().canRedo).toBe(false);
  });

  it('coalesces rapid edits with the same key into one step', () => {
    let t = 0;
    const doc = fresh();
    const store = new EditorStore(doc, { now: () => (t += 100) });
    const cam = doc.pages.capture.elements[0]!;
    for (let i = 0; i < 5; i++) {
      store.apply('Nudge', (d) => nudge(d, capture, [cam.id], 1, 0), { coalesceKey: 'nudge' });
    }
    expect(store.historySize().past).toBe(1);
    expect(store.getState().doc.pages.capture.elements[0]!.x).toBe(85);
    store.undo();
    expect(store.getState().doc).toEqual(doc);
  });

  it(`keeps at least 100 steps (limit ${HISTORY_LIMIT})`, () => {
    const { store, original, camera } = setup();
    for (let i = 1; i <= 150; i++) {
      store.apply('x', (d) => setGeometry(d, capture, [{ id: camera.id, x: i }]));
    }
    let undone = 0;
    while (store.undo()) undone++;
    expect(undone).toBe(150);
    expect(store.getState().doc).toEqual(original);
  });
});

describe('operations are undoable', () => {
  it('drag, resize, rotate (camera-view + 4 slots)', () => {
    const { store, original, camera, slots } = setup();
    store.apply('Ubah', (d) =>
      setGeometry(d, capture, [
        { id: camera.id, x: 400, y: 200, width: 960, height: 540, rotation: 370 },
        ...slots.map((s, i) => ({ id: s.id, x: 100 + i * 10, y: 900 })),
      ]),
    );
    const cam = store.getState().doc.pages.capture.elements[0]!;
    expect(cam).toMatchObject({ x: 400, y: 200, width: 960, height: 540, rotation: 10 });
    roundTrip(store, original);
  });

  it('delete, duplicate, add', () => {
    const { store, original, camera, slots } = setup();
    store.apply('Hapus', (d) => deleteElements(d, capture, [slots[3]!.id]));
    store.apply('Duplikat', (d) => void duplicateElements(d, capture, [camera.id]));
    const added = createElement('text', original, { center: { x: 960, y: 540 } });
    store.apply('Tambah', (d) => void addElements(d, capture, [added]));
    const types = store.getState().doc.pages.capture.elements.map((e) => e.type);
    expect(types.filter((t) => t === 'camera-view')).toHaveLength(2);
    expect(types.filter((t) => t === 'photo-slot')).toHaveLength(3);
    expect(types.at(-1)).toBe('text');
    roundTrip(store, original);
  });

  it('copy/paste across pages keeps position and skips elements not allowed there', () => {
    const { store, original, camera } = setup();
    const title = original.pages.cover.elements[0]!;
    const clipboard = [structuredClone(title), structuredClone(camera)] as Element[];
    const ctx: EditCtx = { target: { kind: 'page', page: 'result' }, slideId: null };
    let pasted: string[] = [];
    store.apply('Tempel', (d) => {
      pasted = pasteElements(d, ctx, clipboard);
    });
    expect(pasted).toHaveLength(1); // camera-view is capture-only
    const copy = store.getState().doc.pages.result.elements.at(-1)!;
    expect(copy).toMatchObject({ type: 'text', x: title.x, y: title.y });
    expect(copy.id).not.toBe(title.id);
    roundTrip(store, original);
  });

  it('group, ungroup, lock, hide, reorder, layer drag', () => {
    const { store, original, slots, ids } = setup();
    const [a, b] = [slots[0]!.id, slots[1]!.id];
    store.apply('Group', (d) => void groupElements(d, capture, [a, b]));
    expect(expandGroups(store.getState().doc, capture, [a])).toEqual(
      expect.arrayContaining([a, b]),
    );
    store.apply('Ungroup', (d) => ungroupElements(d, capture, [a, b]));
    store.apply('Lock', (d) => setFlag(d, capture, [a], 'locked', true));
    store.apply('Hide', (d) => setFlag(d, capture, [b], 'visible', false));
    store.apply('Front', (d) => reorder(d, capture, [a], 'front'));
    expect(ids(store.getState().doc).at(-1)).toBe(a);
    store.apply('Back', (d) => reorder(d, capture, [a], 'back'));
    expect(ids(store.getState().doc)[0]).toBe(a);
    store.apply('Forward', (d) => reorder(d, capture, [a], 'forward'));
    expect(ids(store.getState().doc)[1]).toBe(a);
    store.apply('Drag layer', (d) => moveToIndex(d, capture, a, 5));
    expect(ids(store.getState().doc)[5]).toBe(a);
    roundTrip(store, original);
  });

  it('align and distribute', () => {
    const { store, original, slots } = setup();
    const sel = slots.map((s) => s.id);
    store.apply('Acak', (d) =>
      setGeometry(
        d,
        capture,
        slots.map((s, i) => ({ id: s.id, x: 100 + i * 37, y: 50 + i * i * 90 })),
      ),
    );
    store.apply('Align', (d) => align(d, capture, sel, 'left'));
    store.apply('Distribute', (d) => distribute(d, capture, sel, 'vertical'));
    const doc = store.getState().doc;
    const ys = selectedElements(doc, capture, sel).map((e) => e.y);
    expect(new Set(selectedElements(doc, capture, sel).map((e) => e.x)).size).toBe(1);
    expect(ys[1]! - ys[0]!).toBeCloseTo(ys[2]! - ys[1]!);
    roundTrip(store, original);
  });

  it('property edits, including the background', () => {
    const { store, original, camera } = setup();
    store.apply('Mirror', (d) =>
      updateElement(d, capture, camera.id, { mirror: false, style: { borderRadius: 0 } }),
    );
    store.apply('Latar', (d) => {
      d.pages.capture.background = { kind: 'color', color: '#ff0000' };
    });
    roundTrip(store, original);
  });

  it('frame slots', () => {
    const { store, original } = setup();
    const ctx: EditCtx = {
      target: { kind: 'frame', frameId: original.frames[0]!.id },
      slideId: null,
    };
    store.apply('Slot', (d) => void addSlot(d, ctx));
    store.apply('Geser slot', (d) => setGeometry(d, ctx, [{ id: 'slot:5', y: 100 }]));
    store.apply('Urutan', (d) => shiftSlotOrder(d, ctx, 5, -1));
    store.apply('Hapus slot', (d) => deleteElements(d, ctx, ['slot:1']));
    const slots = store.getState().doc.frames[0]!.slots;
    expect(slots.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    roundTrip(store, original);
  });

  it('tutorial: static elements go to the current slide', () => {
    const { store, original } = setup();
    const slideId = original.pages.tutorial.slides![0]!.id;
    const ctx: EditCtx = { target: { kind: 'page', page: 'tutorial' }, slideId };
    const text = createElement('text', original, { center: { x: 0, y: 0 } });
    const button = createElement('button', original, { center: { x: 0, y: 0 } });
    store.apply('Tambah', (d) => void addElements(d, ctx, [text, button]));
    const doc = store.getState().doc;
    expect(doc.pages.tutorial.slides![0]!.elements.at(-1)!.id).toBe(text.id);
    expect(doc.pages.tutorial.elements.at(-1)!.id).toBe(button.id);
    expect(elementsOf(doc, ctx).map((e) => e.id)).toEqual(
      expect.arrayContaining([text.id, button.id]),
    );
  });
});

import { createId } from '@paralleldrive/cuid2';
import {
  ELEMENT_ALLOWED_PAGES,
  STATIC_ELEMENT_TYPES,
  type BoothConfig,
  type Element,
  type ElementType,
  type Frame,
  type PhotoSlot,
} from '@pb/schema';
import type { Draft } from 'immer';
import type { EditTarget } from './store';

/** Where element operations apply. */
export type EditCtx = { target: EditTarget; slideId: string | null };

type Doc = BoothConfig | Draft<BoothConfig>;

export const FRAME_ELEMENT_TYPES: readonly ElementType[] = [
  'text',
  'image',
  'shape',
  'download-qr',
];

export function frameOf<D extends Doc>(doc: D, ctx: EditCtx): D['frames'][number] | undefined {
  if (ctx.target.kind !== 'frame') return undefined;
  const id = ctx.target.frameId;
  return (doc.frames as Frame[]).find((f) => f.id === id) as D['frames'][number] | undefined;
}

/** Element lists editable in the context, in render order (tutorial: slide first, then page). */
export function listsOf(doc: Doc, ctx: EditCtx): Element[][] {
  if (ctx.target.kind === 'frame') {
    const frame = frameOf(doc, ctx);
    return frame ? [frame.dynamicElements as Element[]] : [];
  }
  const page = doc.pages[ctx.target.page];
  const lists: Element[][] = [];
  if (ctx.target.page === 'tutorial' && ctx.slideId) {
    const slide = page.slides?.find((s) => s.id === ctx.slideId);
    if (slide) lists.push(slide.elements as Element[]);
  }
  lists.push(page.elements as Element[]);
  return lists;
}

export function elementsOf(doc: Doc, ctx: EditCtx): Element[] {
  return listsOf(doc, ctx).flat();
}

export function locate(
  doc: Doc,
  ctx: EditCtx,
  id: string,
): { list: Element[]; index: number; el: Element } | null {
  for (const list of listsOf(doc, ctx)) {
    const index = list.findIndex((e) => e.id === id);
    if (index !== -1) return { list, index, el: list[index]! };
  }
  return null;
}

/** Artboard size for the context (strip px in frame mode). */
export function canvasSize(doc: Doc, ctx: EditCtx): { width: number; height: number } {
  return ctx.target.kind === 'frame'
    ? { ...doc.printProfile.stripPx }
    : { width: doc.artboard.width, height: doc.artboard.height };
}

/** Selection keys incl. other members of each selected element's group. */
export function expandGroups(doc: Doc, ctx: EditCtx, ids: string[]): string[] {
  const all = elementsOf(doc, ctx);
  const groups = new Set(
    ids.map((id) => all.find((e) => e.id === id)?.groupId).filter((g): g is string => !!g),
  );
  const out = new Set(ids);
  for (const el of all) if (el.groupId && groups.has(el.groupId)) out.add(el.id);
  return [...out];
}

/** Can an element of this type live in the context? */
export function allowedHere(type: ElementType, ctx: EditCtx, toSlide: boolean): boolean {
  if (ctx.target.kind === 'frame') return FRAME_ELEMENT_TYPES.includes(type);
  if (toSlide) return (STATIC_ELEMENT_TYPES as readonly string[]).includes(type);
  const allowed = ELEMENT_ALLOWED_PAGES[type];
  return !allowed || allowed.includes(ctx.target.page);
}

// --- Geometry -------------------------------------------------------------------------------

export type Geometry = { x: number; y: number; width: number; height: number; rotation: number };

const round = (v: number) => Math.round(v * 10) / 10;

export function setGeometry(
  d: Draft<BoothConfig>,
  ctx: EditCtx,
  updates: ({ id: string } & Partial<Geometry>)[],
) {
  for (const u of updates) {
    if (u.id.startsWith('slot:')) {
      setSlotGeometry(d, ctx, Number(u.id.slice(5)), u);
      continue;
    }
    const hit = locate(d, ctx, u.id);
    if (!hit) continue;
    const el = hit.el;
    if (u.x !== undefined) el.x = round(u.x);
    if (u.y !== undefined) el.y = round(u.y);
    if (u.width !== undefined) el.width = Math.max(1, round(u.width));
    if (u.height !== undefined) el.height = Math.max(1, round(u.height));
    if (u.rotation !== undefined) el.rotation = normalizeRotation(u.rotation);
  }
}

export function normalizeRotation(deg: number): number {
  let r = round(deg % 360);
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Object.is(r, -0) ? 0 : r;
}

export function nudge(d: Draft<BoothConfig>, ctx: EditCtx, ids: string[], dx: number, dy: number) {
  const current = ids
    .map((id) => geometryOf(d, ctx, id))
    .filter((g): g is Geometry & { id: string } => !!g);
  setGeometry(
    d,
    ctx,
    current.map((g) => ({ id: g.id, x: g.x + dx, y: g.y + dy })),
  );
}

export function geometryOf(doc: Doc, ctx: EditCtx, id: string): (Geometry & { id: string }) | null {
  if (id.startsWith('slot:')) {
    const slot = frameOf(doc, ctx)?.slots.find((s) => s.index === Number(id.slice(5)));
    return slot
      ? {
          id,
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
          rotation: slot.rotation,
        }
      : null;
  }
  const hit = locate(doc, ctx, id);
  if (!hit) return null;
  const { x, y, width, height, rotation } = hit.el;
  return { id, x, y, width, height, rotation };
}

// --- Element CRUD ---------------------------------------------------------------------------

export function updateElement(
  d: Draft<BoothConfig>,
  ctx: EditCtx,
  id: string,
  patch: Record<string, unknown>,
) {
  const hit = locate(d, ctx, id);
  if (!hit) return;
  const el = hit.el as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || k === 'type') continue;
    if (v === undefined) delete el[k];
    else el[k] = v;
  }
}

/** Adds elements on top. Tutorial: static elements go to the current slide. Returns added ids. */
export function addElements(d: Draft<BoothConfig>, ctx: EditCtx, elements: Element[]): string[] {
  const lists = listsOf(d, ctx);
  const added: string[] = [];
  const toSlide =
    ctx.target.kind === 'page' && ctx.target.page === 'tutorial' && lists.length === 2;
  for (const el of elements) {
    const isStatic = (STATIC_ELEMENT_TYPES as readonly string[]).includes(el.type);
    const intoSlide = toSlide && isStatic;
    if (!allowedHere(el.type, ctx, intoSlide)) continue;
    const list = intoSlide ? lists[0]! : lists.at(-1)!;
    list.push(el);
    added.push(el.id);
  }
  return added;
}

export function deleteElements(d: Draft<BoothConfig>, ctx: EditCtx, ids: string[]) {
  const set = new Set(ids);
  for (const list of listsOf(d, ctx)) {
    for (let i = list.length - 1; i >= 0; i--) if (set.has(list[i]!.id)) list.splice(i, 1);
  }
  const slots = ids.filter((id) => id.startsWith('slot:')).map((id) => Number(id.slice(5)));
  if (slots.length) deleteSlots(d, ctx, slots);
}

/** Plain deep copy (works on Immer drafts too; configs are JSON). */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Deep copy with fresh ids; groups are remapped so copies form their own groups. */
export function cloneElements(elements: readonly Element[], offset: number): Element[] {
  const groupMap = new Map<string, string>();
  return elements.map((el) => {
    const copy = clone(el);
    copy.id = createId();
    copy.x = round(copy.x + offset);
    copy.y = round(copy.y + offset);
    if (copy.groupId) {
      if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, createId());
      copy.groupId = groupMap.get(copy.groupId);
    }
    return copy;
  });
}

export function selectedElements(doc: Doc, ctx: EditCtx, ids: string[]): Element[] {
  // Keep layer order so pasted copies stack the same way.
  const set = new Set(ids);
  return elementsOf(doc, ctx).filter((e) => set.has(e.id));
}

export function duplicateElements(d: Draft<BoothConfig>, ctx: EditCtx, ids: string[]): string[] {
  const copies = cloneElements(
    selectedElements(d, ctx, ids).map((e) => clone(e)),
    20,
  );
  return addElements(d, ctx, copies);
}

export function pasteElements(d: Draft<BoothConfig>, ctx: EditCtx, clipboard: Element[]): string[] {
  const existing = new Set(elementsOf(d, ctx).map((e) => e.id));
  // Same place when pasted into another page, offset when the originals are here.
  const offset = clipboard.some((e) => existing.has(e.id)) ? 20 : 0;
  return addElements(d, ctx, cloneElements(clipboard, offset));
}

// --- Flags, groups, order -------------------------------------------------------------------

export function setFlag(
  d: Draft<BoothConfig>,
  ctx: EditCtx,
  ids: string[],
  flag: 'locked' | 'visible',
  value: boolean,
) {
  for (const id of ids) {
    const hit = locate(d, ctx, id);
    if (hit) hit.el[flag] = value;
  }
}

export function groupElements(d: Draft<BoothConfig>, ctx: EditCtx, ids: string[]): string | null {
  if (ids.length < 2) return null;
  const groupId = createId();
  for (const id of ids) {
    const hit = locate(d, ctx, id);
    if (hit) hit.el.groupId = groupId;
  }
  return groupId;
}

export function ungroupElements(d: Draft<BoothConfig>, ctx: EditCtx, ids: string[]) {
  for (const id of ids) {
    const hit = locate(d, ctx, id);
    if (hit) delete hit.el.groupId;
  }
}

export type ReorderMode = 'forward' | 'backward' | 'front' | 'back';

export function reorder(d: Draft<BoothConfig>, ctx: EditCtx, ids: string[], mode: ReorderMode) {
  const set = new Set(ids);
  for (const list of listsOf(d, ctx)) {
    const picked = list.filter((e) => set.has(e.id));
    if (picked.length === 0) continue;
    if (mode === 'front' || mode === 'back') {
      const rest = list.filter((e) => !set.has(e.id));
      const next = mode === 'front' ? [...rest, ...picked] : [...picked, ...rest];
      list.splice(0, list.length, ...next);
      continue;
    }
    const step = mode === 'forward' ? 1 : -1;
    const indices = list.map((e, i) => (set.has(e.id) ? i : -1)).filter((i) => i >= 0);
    if (step === 1) indices.reverse();
    for (const i of indices) {
      const j = i + step;
      if (j < 0 || j >= list.length || set.has(list[j]!.id)) continue;
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
  }
}

/** Layer panel drag: move one element to an index of its own list. */
export function moveToIndex(d: Draft<BoothConfig>, ctx: EditCtx, id: string, toIndex: number) {
  const hit = locate(d, ctx, id);
  if (!hit) return;
  const [el] = hit.list.splice(hit.index, 1);
  const index = Math.max(0, Math.min(hit.list.length, toIndex));
  hit.list.splice(index, 0, el!);
}

// --- Align & distribute (axis-aligned boxes, rotation ignored) -------------------------------

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function align(d: Draft<BoothConfig>, ctx: EditCtx, ids: string[], mode: AlignMode) {
  const boxes = ids
    .map((id) => geometryOf(d, ctx, id))
    .filter((g): g is Geometry & { id: string } => !!g);
  if (boxes.length === 0) return;
  // One element aligns to the artboard; several align to their common bounds.
  const bounds =
    boxes.length === 1
      ? { left: 0, top: 0, right: canvasSize(d, ctx).width, bottom: canvasSize(d, ctx).height }
      : {
          left: Math.min(...boxes.map((b) => b.x)),
          top: Math.min(...boxes.map((b) => b.y)),
          right: Math.max(...boxes.map((b) => b.x + b.width)),
          bottom: Math.max(...boxes.map((b) => b.y + b.height)),
        };
  setGeometry(
    d,
    ctx,
    boxes.map((b) => {
      switch (mode) {
        case 'left':
          return { id: b.id, x: bounds.left };
        case 'right':
          return { id: b.id, x: bounds.right - b.width };
        case 'hcenter':
          return { id: b.id, x: (bounds.left + bounds.right) / 2 - b.width / 2 };
        case 'top':
          return { id: b.id, y: bounds.top };
        case 'bottom':
          return { id: b.id, y: bounds.bottom - b.height };
        case 'vcenter':
          return { id: b.id, y: (bounds.top + bounds.bottom) / 2 - b.height / 2 };
      }
    }),
  );
}

/** Equal gaps between ≥ 3 elements along an axis; the outermost stay put. */
export function distribute(
  d: Draft<BoothConfig>,
  ctx: EditCtx,
  ids: string[],
  axis: 'horizontal' | 'vertical',
) {
  const boxes = ids
    .map((id) => geometryOf(d, ctx, id))
    .filter((g): g is Geometry & { id: string } => !!g);
  if (boxes.length < 3) return;
  const pos = axis === 'horizontal' ? 'x' : 'y';
  const size = axis === 'horizontal' ? 'width' : 'height';
  boxes.sort((a, b) => a[pos] - b[pos]);
  const first = boxes[0]!;
  const last = boxes.at(-1)!;
  const total = boxes.reduce((s, b) => s + b[size], 0);
  const gap = (last[pos] + last[size] - first[pos] - total) / (boxes.length - 1);
  let cursor = first[pos];
  setGeometry(
    d,
    ctx,
    boxes.map((b) => {
      const out = { id: b.id, [pos]: cursor };
      cursor += b[size] + gap;
      return out;
    }),
  );
}

// --- Frame slots ----------------------------------------------------------------------------

export function setSlotGeometry(
  d: Draft<BoothConfig>,
  ctx: EditCtx,
  index: number,
  g: Partial<Geometry>,
) {
  const slot = frameOf(d, ctx)?.slots.find((s) => s.index === index);
  if (!slot) return;
  if (g.x !== undefined) slot.x = round(g.x);
  if (g.y !== undefined) slot.y = round(g.y);
  if (g.width !== undefined) slot.width = Math.max(1, round(g.width));
  if (g.height !== undefined) slot.height = Math.max(1, round(g.height));
  if (g.rotation !== undefined) slot.rotation = normalizeRotation(g.rotation);
}

export function updateSlot(
  d: Draft<BoothConfig>,
  ctx: EditCtx,
  index: number,
  patch: Partial<PhotoSlot>,
) {
  const slot = frameOf(d, ctx)?.slots.find((s) => s.index === index);
  if (slot) Object.assign(slot, { ...patch, index: slot.index });
}

export function addSlot(d: Draft<BoothConfig>, ctx: EditCtx): number | null {
  const frame = frameOf(d, ctx);
  if (!frame) return null;
  const strip = d.printProfile.stripPx;
  const index = frame.slots.length + 1;
  const width = Math.round(strip.width * 0.9);
  const height = Math.round(width / 1.5);
  frame.slots.push({
    index,
    x: (strip.width - width) / 2,
    y: Math.min(strip.height - height, 40 + (index - 1) * (height + 20)),
    width,
    height,
    rotation: 0,
    borderRadius: 0,
  });
  return index;
}

/** Removes slots and renumbers the rest 1..n in capture order. */
export function deleteSlots(d: Draft<BoothConfig>, ctx: EditCtx, indices: number[]) {
  const frame = frameOf(d, ctx);
  if (!frame) return;
  const set = new Set(indices);
  const kept = frame.slots.filter((s) => !set.has(s.index)).sort((a, b) => a.index - b.index);
  if (kept.length === 0) return; // a frame needs at least one slot
  kept.forEach((s, i) => (s.index = i + 1));
  frame.slots.splice(0, frame.slots.length, ...kept);
}

/** Moves a slot earlier/later in capture order (swaps index numbers). */
export function shiftSlotOrder(d: Draft<BoothConfig>, ctx: EditCtx, index: number, dir: -1 | 1) {
  const frame = frameOf(d, ctx);
  const a = frame?.slots.find((s) => s.index === index);
  const b = frame?.slots.find((s) => s.index === index + dir);
  if (!a || !b) return;
  a.index += dir;
  b.index -= dir;
  frame!.slots.sort((x, y) => x.index - y.index);
}

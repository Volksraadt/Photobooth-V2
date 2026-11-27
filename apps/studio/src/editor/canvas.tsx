'use client';

import { FrameComposite, PageRenderer, RendererProvider, SAMPLE_PHOTO_URL } from '@pb/renderer';
import type { BoothConfig, Frame } from '@pb/schema';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import { useEditor, useEnv, useStore } from './editor-context';
import {
  canvasSize,
  elementsOf,
  expandGroups,
  frameOf,
  geometryOf,
  setGeometry,
  type EditCtx,
  type Geometry,
} from './operations';
import type { EditorStore } from './store';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

const STAGE_CLASS = 'pb-editor-stage';

/** Canvas DOM node for a selection key (element id or `slot:<n>`). */
function nodeOf(stage: HTMLElement, key: string, frameMode: boolean): HTMLElement | null {
  if (key.startsWith('slot:')) {
    return stage.querySelector<HTMLElement>(`[data-pb-frame-slot="${key.slice(5)}"]`);
  }
  const nodes = stage.querySelectorAll<HTMLElement>(`[data-pb-element-id="${CSS.escape(key)}"]`);
  // Page mode: skip copies drawn inside a frame preview (same ids as the frame's elements).
  for (const n of nodes) if (frameMode || !n.closest('[data-pb-frame-composite]')) return n;
  return null;
}

function keyOf(node: HTMLElement | SVGElement): string | null {
  const el = node as HTMLElement;
  if (el.dataset.pbFrameSlot) return `slot:${el.dataset.pbFrameSlot}`;
  return el.dataset.pbElementId ?? null;
}

/** Restore transient gesture styles to the document values (after commit or cancel). */
function syncDom(
  stage: HTMLElement,
  store: EditorStore,
  ctx: EditCtx,
  keys: string[],
  frameMode: boolean,
) {
  const doc = store.getState().doc;
  for (const key of keys) {
    const node = nodeOf(stage, key, frameMode);
    const g = geometryOf(doc, ctx, key);
    if (!node || !g) continue;
    node.style.left = `${g.x}px`;
    node.style.top = `${g.y}px`;
    node.style.width = `${g.width}px`;
    node.style.height = `${g.height}px`;
    node.style.transform = g.rotation ? `rotate(${g.rotation}deg)` : '';
  }
}

type Gesture = Map<string, Geometry & { id: string }>;

export function Canvas() {
  const store = useStore();
  const env = useEnv();
  const doc = useEditor((s) => s.doc);
  const ui = useEditor((s) => s.ui);
  const ctx = useMemo<EditCtx>(
    () => ({ target: ui.target, slideId: ui.slideId }),
    [ui.target, ui.slideId],
  );
  const frameMode = ui.target.kind === 'frame';
  const size = canvasSize(doc, ctx);

  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Same nodes as state: Moveable/Selecto need them as props (refs must not be read in render).
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const moveableRef = useRef<Moveable>(null);
  const selectoRef = useRef<Selecto>(null);
  const gesture = useRef<Gesture>(new Map());
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const [guides, setGuides] = useState<HTMLElement[]>([]);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [samplePhotos, setSamplePhotos] = useState(true);

  // Selection → Moveable targets (after the renderer has committed the DOM).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const els = elementsOf(doc, ctx);
    const locked = new Set(els.filter((e) => e.locked).map((e) => e.id));
    const next = ui.selection
      .filter((k) => !locked.has(k))
      .map((k) => nodeOf(stage, k, frameMode))
      .filter((n): n is HTMLElement => !!n);
    setTargets((prev) =>
      prev.length === next.length && prev.every((p, i) => p === next[i]) ? prev : next,
    );
    const selected = new Set(ui.selection);
    const others = [
      ...els
        .filter((e) => !selected.has(e.id) && e.visible)
        .map((e) => nodeOf(stage, e.id, frameMode)),
      ...(frameOf(doc, ctx)?.slots ?? [])
        .filter((s) => !selected.has(`slot:${s.index}`))
        .map((s) => nodeOf(stage, `slot:${s.index}`, true)),
    ].filter((n): n is HTMLElement => !!n);
    setGuides(others);
  }, [doc, ctx, ui.selection, frameMode]);

  useLayoutEffect(() => {
    moveableRef.current?.updateRect();
  }, [doc, ui.zoom, ui.pan, targets]);

  // Keys held for pan (space) and aspect-ratio lock (shift).
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return (
        !!t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      );
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);
      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false);
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Wheel: ctrl/⌘ = zoom around the cursor, otherwise pan. Needs a non-passive listener.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoom, pan } = store.getState().ui;
      if (e.ctrlKey || e.metaKey) {
        const rect = vp.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const next = clampZoom(zoom * Math.exp(-e.deltaY * 0.0015));
        store.setUi({
          zoom: next,
          pan: { x: cx - ((cx - pan.x) * next) / zoom, y: cy - ((cy - pan.y) * next) / zoom },
        });
      } else {
        store.setUi({ pan: { x: pan.x - e.deltaX, y: pan.y - e.deltaY } });
      }
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [store]);

  // Space + drag or middle button: pan.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!(spaceHeld || e.button === 1)) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, pan: store.getState().ui.pan };
    const move = (ev: PointerEvent) =>
      store.setUi({
        pan: { x: start.pan.x + ev.clientX - start.x, y: start.pan.y + ev.clientY - start.y },
      });
    const upHandler = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', upHandler);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', upHandler);
  };

  // --- Gesture commit ------------------------------------------------------------------------
  const startGesture = useCallback(
    (nodes: (HTMLElement | SVGElement)[]) => {
      const map: Gesture = new Map();
      const docNow = store.getState().doc;
      for (const n of nodes) {
        const key = keyOf(n as HTMLElement);
        const g = key ? geometryOf(docNow, ctx, key) : null;
        if (g) map.set(g.id, { ...g });
      }
      gesture.current = map;
    },
    [store, ctx],
  );

  const track = (node: HTMLElement | SVGElement, g: Partial<Geometry>) => {
    const key = keyOf(node as HTMLElement);
    const cur = key ? gesture.current.get(key) : undefined;
    if (cur) Object.assign(cur, g);
  };

  const commit = useCallback(
    (label: string) => {
      const updates = [...gesture.current.values()];
      gesture.current = new Map();
      const keys = updates.map((u) => u.id);
      if (updates.length) store.apply(label, (d) => setGeometry(d, ctx, updates));
      // Let React apply the document values, then clear any leftover transient styles.
      requestAnimationFrame(() => {
        if (stageRef.current) syncDom(stageRef.current, store, ctx, keys, frameMode);
        moveableRef.current?.updateRect();
      });
    },
    [store, ctx, frameMode],
  );

  const style = (node: HTMLElement | SVGElement) => (node as HTMLElement).style;
  const startRotation = (node: HTMLElement | SVGElement) => {
    const key = keyOf(node as HTMLElement);
    return key ? (geometryOf(store.getState().doc, ctx, key)?.rotation ?? 0) : 0;
  };

  const select = useCallback(
    (keys: string[]) => {
      const docNow = store.getState().doc;
      const els = elementsOf(docNow, ctx);
      const locked = new Set(els.filter((e) => e.locked).map((e) => e.id));
      store.setUi({
        selection: expandGroups(
          docNow,
          ctx,
          keys.filter((k) => !locked.has(k)),
        ),
      });
    },
    [store, ctx],
  );

  const fitToScreen = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const { width, height } = vp.getBoundingClientRect();
    const zoom = clampZoom(Math.min((width - 80) / size.width, (height - 80) / size.height));
    store.setUi({
      zoom,
      pan: { x: (width - size.width * zoom) / 2, y: (height - size.height * zoom) / 2 },
    });
  }, [store, size.width, size.height]);

  // Fit when the canvas size changes (page ↔ frame) and on first mount.
  useEffect(() => {
    fitToScreen();
  }, [fitToScreen]);

  useEffect(() => {
    const onFit = () => fitToScreen();
    window.addEventListener('pb-editor-fit', onFit);
    return () => window.removeEventListener('pb-editor-fit', onFit);
  }, [fitToScreen]);

  const bounds = {
    left: -size.width,
    top: -size.height,
    right: size.width * 2,
    bottom: size.height * 2,
  };
  const verticalGuidelines = [0, size.width / 2, size.width];
  const horizontalGuidelines = [0, size.height / 2, size.height];
  const lockedFor = (k: string) => elementsOf(doc, ctx).find((e) => e.id === k)?.locked;
  const canTransform = env.canEdit && !ui.selection.some(lockedFor);

  return (
    <div
      ref={(n) => {
        viewportRef.current = n;
        setViewportEl(n);
      }}
      data-testid="editor-viewport"
      className="relative h-full w-full overflow-hidden bg-slate-100 bg-[radial-gradient(circle,rgb(148_163_184/0.35)_1px,transparent_1px)] [background-size:16px_16px] select-none"
      style={{ cursor: spaceHeld ? 'grab' : undefined }}
      onPointerDownCapture={onPointerDown}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transformOrigin: '0 0',
          transform: `translate(${ui.pan.x}px, ${ui.pan.y}px) scale(${ui.zoom})`,
        }}
      >
        <div
          ref={(n) => {
            stageRef.current = n;
            setStageEl(n);
          }}
          className={STAGE_CLASS}
          data-testid="editor-stage"
          style={{
            width: size.width,
            height: size.height,
            position: 'relative',
            boxShadow: '0 4px 30px rgba(0,0,0,0.25)',
          }}
        >
          {ui.target.kind === 'page' ? (
            <PageStage doc={doc} ctx={ctx} boothName={env.boothName} />
          ) : (
            <FrameStage
              doc={doc}
              frame={frameOf(doc, ctx)}
              boothName={env.boothName}
              samples={samplePhotos}
            />
          )}
        </div>
      </div>

      {env.canEdit && (
        <Moveable
          ref={moveableRef}
          target={targets.length === 1 ? targets[0]! : targets}
          rootContainer={viewportEl ?? undefined}
          draggable={canTransform}
          resizable={canTransform}
          rotatable={canTransform}
          keepRatio={shiftHeld}
          throttleDrag={0}
          throttleResize={0}
          throttleRotate={0}
          origin={false}
          snappable
          snapContainer={stageEl ?? undefined}
          snapThreshold={6}
          snapGridWidth={ui.snapToGrid ? ui.gridSize : 0}
          snapGridHeight={ui.snapToGrid ? ui.gridSize : 0}
          isDisplaySnapDigit
          isDisplayInnerSnapDigit
          snapDirections={{
            top: true,
            left: true,
            bottom: true,
            right: true,
            center: true,
            middle: true,
          }}
          elementSnapDirections={{
            top: true,
            left: true,
            bottom: true,
            right: true,
            center: true,
            middle: true,
          }}
          verticalGuidelines={verticalGuidelines}
          horizontalGuidelines={horizontalGuidelines}
          elementGuidelines={guides}
          bounds={bounds}
          // Single target
          onDragStart={(e) => startGesture([e.target])}
          onDrag={(e) => {
            style(e.target).left = `${e.left}px`;
            style(e.target).top = `${e.top}px`;
            track(e.target, { x: e.left, y: e.top });
          }}
          onDragEnd={(e) => (e.lastEvent ? commit('Geser elemen') : commit(''))}
          onResizeStart={(e) => startGesture([e.target])}
          onResize={(e) => {
            const s = style(e.target);
            s.width = `${e.width}px`;
            s.height = `${e.height}px`;
            s.left = `${e.drag.left}px`;
            s.top = `${e.drag.top}px`;
            track(e.target, { width: e.width, height: e.height, x: e.drag.left, y: e.drag.top });
          }}
          onResizeEnd={(e) => (e.lastEvent ? commit('Ubah ukuran') : commit(''))}
          onRotateStart={(e) => startGesture([e.target])}
          onRotate={(e) => {
            const rotation = startRotation(e.target) + e.dist;
            style(e.target).transform = `rotate(${rotation}deg)`;
            style(e.target).left = `${e.drag.left}px`;
            style(e.target).top = `${e.drag.top}px`;
            track(e.target, { rotation, x: e.drag.left, y: e.drag.top });
          }}
          onRotateEnd={(e) => (e.lastEvent ? commit('Putar elemen') : commit(''))}
          // Group
          onDragGroupStart={(e) => startGesture(e.targets)}
          onDragGroup={(e) => {
            for (const ev of e.events) {
              style(ev.target).left = `${ev.left}px`;
              style(ev.target).top = `${ev.top}px`;
              track(ev.target, { x: ev.left, y: ev.top });
            }
          }}
          onDragGroupEnd={(e) => (e.lastEvent ? commit('Geser elemen') : commit(''))}
          onResizeGroupStart={(e) => startGesture(e.targets)}
          onResizeGroup={(e) => {
            for (const ev of e.events) {
              const s = style(ev.target);
              s.width = `${ev.width}px`;
              s.height = `${ev.height}px`;
              s.left = `${ev.drag.left}px`;
              s.top = `${ev.drag.top}px`;
              track(ev.target, {
                width: ev.width,
                height: ev.height,
                x: ev.drag.left,
                y: ev.drag.top,
              });
            }
          }}
          onResizeGroupEnd={(e) => (e.lastEvent ? commit('Ubah ukuran') : commit(''))}
          onRotateGroupStart={(e) => startGesture(e.targets)}
          onRotateGroup={(e) => {
            for (const ev of e.events) {
              const rotation = startRotation(ev.target) + ev.dist;
              const s = style(ev.target);
              s.transform = `rotate(${rotation}deg)`;
              s.left = `${ev.drag.left}px`;
              s.top = `${ev.drag.top}px`;
              track(ev.target, { rotation, x: ev.drag.left, y: ev.drag.top });
            }
          }}
          onRotateGroupEnd={(e) => (e.lastEvent ? commit('Putar elemen') : commit(''))}
          onClickGroup={(e) => selectoRef.current?.clickTarget(e.inputEvent, e.inputTarget)}
        />
      )}

      <Selecto
        ref={selectoRef}
        container={viewportEl}
        dragContainer={viewportEl ?? undefined}
        rootContainer={viewportEl ?? undefined}
        selectableTargets={[
          `.${STAGE_CLASS} [data-pb-element-id]`,
          `.${STAGE_CLASS} [data-pb-frame-slot]`,
        ]}
        hitRate={0}
        selectByClick
        selectFromInside={false}
        toggleContinueSelect={['shift']}
        ratio={0}
        onDragStart={(e) => {
          const t = e.inputEvent.target as HTMLElement;
          if (spaceHeld || (e.inputEvent as MouseEvent).button === 1) {
            e.stop();
            return;
          }
          if (
            moveableRef.current?.isMoveableElement(t) ||
            targets.some((n) => n === t || n.contains(t))
          ) {
            e.stop();
          }
        }}
        onSelectEnd={(e) => {
          const stage = stageRef.current;
          const keys = e.selected
            .filter((n) => frameMode || !n.closest('[data-pb-frame-composite]'))
            .filter((n) => {
              // Frame mode: only the frame's own slots/elements; page mode: only top-level elements.
              if (!stage?.contains(n)) return false;
              return !(n as HTMLElement).parentElement?.closest('[data-pb-element-id]');
            })
            .map(keyOf)
            .filter((k): k is string => !!k);
          select(keys);
          if (e.isDragStart && keys.length) {
            e.inputEvent.preventDefault();
            moveableRef.current?.waitToChangeTarget().then(() => {
              moveableRef.current?.dragStart(e.inputEvent);
            });
          }
        }}
      />

      {ui.target.kind === 'frame' && (
        <label className="absolute bottom-3 left-3 flex items-center gap-2 rounded bg-white/90 px-2 py-1 text-xs shadow">
          <input
            type="checkbox"
            checked={samplePhotos}
            onChange={(e) => setSamplePhotos(e.target.checked)}
          />
          Foto contoh
        </label>
      )}
    </div>
  );
}

function PageStage({ doc, ctx, boothName }: { doc: BoothConfig; ctx: EditCtx; boothName: string }) {
  if (ctx.target.kind !== 'page') return null;
  const page = doc.pages[ctx.target.page];
  const slideIndex = Math.max(0, page.slides?.findIndex((s) => s.id === ctx.slideId) ?? 0);
  return (
    <PageRenderer
      page={page}
      config={doc}
      mode="editor"
      fit="none"
      runtime={{ boothName, slideIndex }}
    />
  );
}

function FrameStage({
  doc,
  frame,
  boothName,
  samples,
}: {
  doc: BoothConfig;
  frame: Frame | undefined;
  boothName: string;
  samples: boolean;
}) {
  const strip = doc.printProfile.stripPx;
  const shots = useMemo(
    () =>
      samples && frame
        ? Object.fromEntries(frame.slots.map((s) => [s.index, { url: SAMPLE_PHOTO_URL }]))
        : undefined,
    [samples, frame],
  );
  if (!frame) return null;
  return (
    <RendererProvider config={doc} mode="editor" runtime={{ boothName }}>
      <div
        className="pb-root"
        data-pb-mode="editor"
        style={{
          position: 'relative',
          width: strip.width,
          height: strip.height,
          background: '#ffffff',
        }}
      >
        <FrameComposite
          frame={frame}
          width={strip.width}
          height={strip.height}
          shots={shots}
          showSlotPlaceholders
        />
      </div>
    </RendererProvider>
  );
}

'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

const DRAG_THRESHOLD = 8;
const SNAP = 'x mandatory';

/**
 * Horizontally scrolling row for pickers (frame carousel, filter row). Works with touch, mouse
 * drag and the mouse wheel, snaps to items, and shows ‹ › buttons while more items are hidden.
 * Coordinates: the artboard is CSS-scaled, so pointer deltas are converted to artboard px.
 * In the editor (`interactive` false) nothing moves, but the arrows still show there is more.
 */
export function ScrollRow({
  interactive,
  step,
  height,
  arrowColor = '#ffffff',
  style,
  children,
  testId,
}: {
  interactive: boolean;
  /** Distance of one arrow press (item width + gap), artboard px. */
  step: number;
  /** Box height, used to size the arrows. */
  height: number;
  arrowColor?: string;
  style?: CSSProperties;
  children: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const drag = useRef<{
    x: number;
    left: number;
    scale: number;
    moved: boolean;
    id: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [update, children]);

  // Vertical wheel scrolls the row (non-passive so the page does not scroll instead).
  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollBy({ left: delta });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [interactive]);

  const scale = () => {
    const el = ref.current;
    if (!el || el.clientWidth === 0) return 1;
    return el.getBoundingClientRect().width / el.clientWidth || 1;
  };

  // Mouse/pen drag; touch keeps the browser's native (momentum) scrolling.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (!interactive || e.pointerType === 'touch' || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    drag.current = {
      x: e.clientX,
      left: el.scrollLeft,
      scale: scale(),
      moved: false,
      id: e.pointerId,
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || d.id !== e.pointerId) return;
    const dx = (e.clientX - d.x) / d.scale;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
      el.style.scrollSnapType = 'none';
      el.style.scrollBehavior = 'auto';
    }
    el.scrollLeft = d.left - dx;
  };
  const endDrag = () => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d?.moved || !el) return;
    // The click that ends a drag must not select an item (cleared again on the next press).
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    // Settle on the nearest item, then restore snapping (React does not re-apply unchanged styles).
    el.scrollTo({ left: Math.round(el.scrollLeft / step) * step, behavior: 'smooth' });
    setTimeout(() => {
      el.style.scrollSnapType = SNAP;
      el.style.scrollBehavior = 'smooth';
    }, 400);
  };

  const go = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const index = Math.round(el.scrollLeft / step) + dir;
    el.scrollTo({ left: Math.max(0, Math.min(max, index * step)), behavior: 'smooth' });
  };

  const arrow = Math.max(32, Math.min(88, height * 0.16));
  const arrowStyle = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute',
    top: '50%',
    [side]: arrow * 0.15,
    transform: 'translateY(-50%)',
    width: arrow,
    height: arrow,
    borderRadius: arrow,
    border: 'none',
    background: 'rgba(0,0,0,0.55)',
    color: arrowColor,
    fontSize: arrow * 0.6,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: interactive ? 'pointer' : 'default',
    pointerEvents: interactive ? 'auto' : 'none',
    zIndex: 2,
    padding: 0,
    paddingBottom: arrow * 0.08,
  });

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        ref={ref}
        data-pb-scroll-row={testId}
        onScroll={update}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexWrap: 'nowrap',
          overflowX: interactive ? 'auto' : 'hidden',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
          scrollSnapType: SNAP,
          scrollBehavior: 'smooth',
          overscrollBehaviorX: 'contain',
          touchAction: 'pan-x',
          WebkitOverflowScrolling: 'touch',
          ...style,
        }}
      >
        {children}
      </div>
      {edges.start && (
        <button
          type="button"
          aria-label="Sebelumnya"
          data-pb-scroll-prev
          tabIndex={interactive ? 0 : -1}
          onClick={() => go(-1)}
          style={arrowStyle('left')}
        >
          ‹
        </button>
      )}
      {edges.end && (
        <button
          type="button"
          aria-label="Berikutnya"
          data-pb-scroll-next
          tabIndex={interactive ? 0 : -1}
          onClick={() => go(1)}
          style={arrowStyle('right')}
        >
          ›
        </button>
      )}
    </div>
  );
}

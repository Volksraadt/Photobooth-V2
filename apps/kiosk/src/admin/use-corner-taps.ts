import { useEffect, useRef } from 'react';

export const CORNER_SIZE_PX = 100;
export const CORNER_TAPS = 5;
export const CORNER_WINDOW_MS = 3000;

/**
 * Hidden admin gesture: 5 taps in the top-left corner within 3 s. Listens in the capture phase
 * without stopping propagation, so it never blocks the owner's design.
 */
export function useCornerTaps(onTrigger: () => void, enabled = true): void {
  const taps = useRef<number[]>([]);
  const trigger = useRef(onTrigger);
  useEffect(() => {
    trigger.current = onTrigger;
  });

  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      if (e.clientX > CORNER_SIZE_PX || e.clientY > CORNER_SIZE_PX) {
        taps.current = [];
        return;
      }
      const now = performance.now();
      taps.current = [...taps.current.filter((t) => now - t < CORNER_WINDOW_MS), now];
      if (taps.current.length >= CORNER_TAPS) {
        taps.current = [];
        trigger.current();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [enabled]);
}

import { DEFAULT_STRIP_SLOTS } from '@pb/schema';
import { describe, expect, it } from 'vitest';
import { detectSlots } from './detect-slots';

/** Opaque image with transparent rectangles cut out. */
function image(w: number, h: number, holes: [number, number, number, number][]) {
  const alpha = new Uint8Array(w * h).fill(255);
  for (const [x, y, hw, hh] of holes)
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + hw; xx++) alpha[yy * w + xx] = 0;
  return { width: w, height: h, alpha };
}

describe('detectSlots', () => {
  it('finds the four windows of the built-in strip, in order', () => {
    const img = image(
      600,
      1800,
      DEFAULT_STRIP_SLOTS.map((s) => [s.x, s.y, s.width, s.height]),
    );
    expect(detectSlots(img)).toEqual(DEFAULT_STRIP_SLOTS);
  });

  it('scales other sizes to strip px and orders rows then columns', () => {
    // 300×900 (half size): two side-by-side windows, then one wide window below.
    const img = image(300, 900, [
      [150, 20, 120, 100],
      [20, 20, 120, 100],
      [20, 300, 260, 200],
    ]);
    const slots = detectSlots(img);
    expect(slots.map((s) => [s.index, s.x, s.y, s.width, s.height])).toEqual([
      [1, 40, 40, 240, 200],
      [2, 300, 40, 240, 200],
      [3, 40, 600, 520, 400],
    ]);
  });

  it('ignores transparent margins touching the edge and tiny specks', () => {
    const img = image(600, 1800, [
      [0, 0, 600, 20],
      [300, 900, 4, 4],
      [30, 100, 540, 360],
    ]);
    expect(detectSlots(img)).toHaveLength(1);
  });
});

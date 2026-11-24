import { describe, expect, it } from 'vitest';
import { NEUTRAL_FILTER_PARAMS } from './filter';
import { applyFilterColorMatrix, filterColorMatrix, isNeutralColorMatrix } from './filter-math';

const px = (p: Partial<typeof NEUTRAL_FILTER_PARAMS>, rgb: [number, number, number]) =>
  applyFilterColorMatrix(filterColorMatrix({ ...NEUTRAL_FILTER_PARAMS, ...p }), rgb);

describe('filterColorMatrix', () => {
  it('is the identity for neutral params', () => {
    expect(isNeutralColorMatrix(filterColorMatrix(NEUTRAL_FILTER_PARAMS))).toBe(true);
    expect(px({}, [12, 128, 250])).toEqual([12, 128, 250]);
  });

  it('matches the CSS filter definitions for single operations', () => {
    expect(px({ brightness: 0.5 }, [200, 100, 50])).toEqual([100, 50, 25]);
    // contrast(c): (v - 0.5) * c + 0.5
    expect(px({ contrast: 2 }, [192, 64, 128])).toEqual([255, 0, 129]);
    // saturate(0) → luma (0.213, 0.715, 0.072)
    const [r, g, b] = px({ saturation: 0 }, [255, 0, 0]);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBe(Math.round(0.213 * 255));
    // sepia(1) of white is clamped to white-ish warm tone
    expect(px({ sepia: 1 }, [100, 100, 100])).toEqual([
      Math.round(100 * (0.393 + 0.769 + 0.189)),
      Math.round(100 * (0.349 + 0.686 + 0.168)),
      Math.round(100 * (0.272 + 0.534 + 0.131)),
    ]);
    // hue-rotate(360) is (numerically) the identity
    expect(px({ hueRotate: 180 }, [10, 10, 10])).toEqual([10, 10, 10]);
  });

  it('warmth tints orange (positive) or blue (negative)', () => {
    const [wr, , wb] = px({ warmth: 1 }, [128, 128, 128]);
    expect(wr).toBeGreaterThan(128);
    expect(wb).toBeLessThan(128);
    const [cr, , cb] = px({ warmth: -1 }, [128, 128, 128]);
    expect(cr).toBeLessThan(128);
    expect(cb).toBeGreaterThan(128);
  });

  it('applies operations in the documented order (brightness before contrast)', () => {
    // brightness 0.5 then contrast 2: ((0.8*0.5) - 0.5) * 2 + 0.5 = 0.3
    expect(px({ brightness: 0.5, contrast: 2 }, [204, 204, 204])).toEqual([77, 77, 77]);
  });
});

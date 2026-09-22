import { describe, expect, it } from 'vitest';
import { extractRegion, splitAtSeam } from '@/render/textureUpdate';
import type { RasterSize } from '@/model/world';

describe('découpe à la couture', () => {
  it('laisse entière une boîte qui ne déborde pas', () => {
    expect(splitAtSeam({ x: 2, y: 0, w: 4, h: 3 }, 16)).toEqual([{ x: 2, y: 0, w: 4, h: 3 }]);
  });

  it('scinde une boîte qui enjambe le méridien ±180', () => {
    // texSubImage2D ne connaît pas le wrap : il faut deux envois.
    const pieces = splitAtSeam({ x: 14, y: 1, w: 5, h: 2 }, 16);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual({ x: 14, y: 1, w: 2, h: 2 });
    expect(pieces[1]).toEqual({ x: 0, y: 1, w: 3, h: 2 });
  });

  it('ramène dans le domaine une abscisse négative', () => {
    expect(splitAtSeam({ x: -2, y: 0, w: 2, h: 1 }, 16)[0]!.x).toBe(14);
  });

  it('conserve la surface totale', () => {
    const pieces = splitAtSeam({ x: 15, y: 0, w: 6, h: 4 }, 16);
    const area = pieces.reduce((n, p) => n + p.w * p.h, 0);
    expect(area).toBe(6 * 4);
  });
});

describe('extraction d une sous-image', () => {
  const size: RasterSize = { width: 8, height: 4 };

  function raster(): Float32Array {
    const data = new Float32Array(size.width * size.height);
    for (let i = 0; i < data.length; i += 1) data[i] = i;
    return data;
  }

  it('recopie la boîte ligne par ligne', () => {
    const out = extractRegion(raster(), size, { x: 2, y: 1, w: 3, h: 2 });
    expect(Array.from(out)).toEqual([10, 11, 12, 18, 19, 20]);
  });

  it('rend exactement le nombre de valeurs de la boîte', () => {
    expect(extractRegion(raster(), size, { x: 0, y: 0, w: 4, h: 3 })).toHaveLength(12);
  });
});

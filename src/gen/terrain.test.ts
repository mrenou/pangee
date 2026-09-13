import { describe, expect, it } from 'vitest';
import { idx, latOfRow } from '@/model/coords';
import {
  DEFAULT_TERRAIN_PARAMS,
  MAX_ALTITUDE_M,
  MAX_DEPTH_M,
  elevationToMeters,
  generateHeight,
} from '@/gen/terrain';
import type { RasterSize } from '@/model/world';

/** Petite grille : la génération est testée sur sa forme, pas sur son grain. */
const size: RasterSize = { width: 64, height: 32 };

function generate(overrides: Partial<typeof DEFAULT_TERRAIN_PARAMS> = {}): Float32Array {
  return generateHeight(size, { ...DEFAULT_TERRAIN_PARAMS, ...overrides });
}

describe('generateHeight', () => {
  it('remplit exactement le raster', () => {
    const h = generate();
    expect(h.length).toBe(size.width * size.height);
    expect(h.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('est déterministe : même seed, même monde cellule par cellule', () => {
    expect(Array.from(generate({ seed: 'alpha' }))).toEqual(
      Array.from(generate({ seed: 'alpha' })),
    );
  });

  it('change de monde quand la seed change', () => {
    const a = generate({ seed: 'alpha' });
    const b = generate({ seed: 'beta' });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('reste dans les bornes d altitude et de profondeur', () => {
    const h = generate();
    for (const v of h) {
      expect(v).toBeLessThanOrEqual(MAX_ALTITUDE_M);
      expect(v).toBeGreaterThanOrEqual(-MAX_DEPTH_M);
    }
  });

  it('produit à la fois des terres et des mers', () => {
    const h = generate();
    expect(h.some((v) => v > 0)).toBe(true);
    expect(h.some((v) => v < 0)).toBe(true);
  });

  it('émerge davantage quand continentSize augmente', () => {
    const landRatio = (h: Float32Array): number =>
      h.reduce((n, v) => (v > 0 ? n + 1 : n), 0) / h.length;
    expect(landRatio(generate({ continentSize: 0.8 }))).toBeGreaterThan(
      landRatio(generate({ continentSize: 0.2 })),
    );
  });

  it('ne laisse pas de couture au méridien ±180', () => {
    // La dernière colonne et la première sont voisines sur le cylindre : leur
    // écart doit être du même ordre que celui de deux colonnes quelconques.
    const h = generate();
    let seamSum = 0;
    let innerSum = 0;
    for (let y = 0; y < size.height; y += 1) {
      seamSum += Math.abs(h[idx(0, y, size.width)]! - h[idx(size.width - 1, y, size.width)]!);
      innerSum += Math.abs(h[idx(1, y, size.width)]! - h[idx(0, y, size.width)]!);
    }
    expect(seamSum / size.height).toBeLessThan((innerSum / size.height) * 4 + 50);
  });

  it('tire les pôles vers l océan, ce qui donne des calottes', () => {
    const h = generate();
    const meanOfRow = (y: number): number => {
      let s = 0;
      for (let x = 0; x < size.width; x += 1) s += h[idx(x, y, size.width)]!;
      return s / size.width;
    };
    expect(Math.abs(latOfRow(0, size.height))).toBeGreaterThan(80);
    expect(meanOfRow(0)).toBeLessThan(0);
    expect(meanOfRow(size.height - 1)).toBeLessThan(0);
  });

  it('réutilise le tampon fourni sans en allouer un autre', () => {
    const buffer = new Float32Array(size.width * size.height);
    expect(generateHeight(size, DEFAULT_TERRAIN_PARAMS, buffer)).toBe(buffer);
  });
});

describe('elevationToMeters', () => {
  it('garde le niveau zéro à zéro', () => {
    expect(elevationToMeters(0)).toBe(0);
  });

  it('atteint les extrêmes aux bornes', () => {
    expect(elevationToMeters(1)).toBeCloseTo(MAX_ALTITUDE_M);
    expect(elevationToMeters(-1)).toBeCloseTo(-MAX_DEPTH_M);
  });

  it('est monotone croissante', () => {
    let previous = -Infinity;
    for (let e = -1; e <= 1; e += 0.05) {
      const v = elevationToMeters(e);
      expect(v).toBeGreaterThan(previous);
      previous = v;
    }
  });

  it('écrase les altitudes médianes : les sommets restent rares', () => {
    // Exposant terrestre > 1 : la moitié de l'échelle donne bien moins que la
    // moitié de l'altitude maximale.
    expect(elevationToMeters(0.5)).toBeLessThan(MAX_ALTITUDE_M * 0.3);
  });
});

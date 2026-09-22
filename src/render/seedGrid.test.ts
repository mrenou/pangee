import { describe, expect, it } from 'vitest';
import {
  FINE_STEP_DEG,
  appearanceLevel,
  hashCell,
  seedPoint,
  spreadOf,
  strideFor,
} from '@/render/seedGrid';

const SPACING_PX = 26;

describe('pas de parcours', () => {
  it('est toujours une puissance de deux', () => {
    for (let ppd = 1; ppd < 500; ppd += 7) {
      const stride = strideFor(ppd, SPACING_PX);
      expect(Number.isInteger(Math.log2(stride))).toBe(true);
    }
  });

  it('se resserre quand on zoome', () => {
    expect(strideFor(6, SPACING_PX)).toBeGreaterThan(strideFor(60, SPACING_PX));
    expect(strideFor(60, SPACING_PX)).toBeGreaterThanOrEqual(strideFor(400, SPACING_PX));
  });

  it('ne descend jamais sous un', () => {
    expect(strideFor(1e6, SPACING_PX)).toBe(1);
    expect(strideFor(0, SPACING_PX)).toBe(1);
  });

  it('garde un espacement proche de la cible', () => {
    // Le pas retenu place les points entre une et deux fois l'espacement visé :
    // c'est la contrepartie d'une progression par puissances de deux.
    for (const ppd of [4, 9, 23, 57, 130, 380]) {
      const spacingDeg = FINE_STEP_DEG * strideFor(ppd, SPACING_PX);
      const spacingPx = spacingDeg * ppd;
      expect(spacingPx).toBeLessThanOrEqual(SPACING_PX * 1.01);
      expect(spacingPx).toBeGreaterThan(SPACING_PX / 2.01);
    }
  });
});

describe('stabilité du semis', () => {
  it('place un point au même endroit quel que soit le zoom', () => {
    // C'est la propriété qui manquait : la grille dépendait du zoom, et chaque
    // cran de molette redistribuait toutes les montagnes.
    const first = seedPoint(1024, 256);
    const again = seedPoint(1024, 256);
    expect(again).toEqual(first);
  });

  it('conserve les points d un pas large quand le pas se resserre', () => {
    // Les indices multiples de huit sont multiples de quatre : un symbole vu de
    // loin reste en place quand de nouveaux s'intercalent autour de lui.
    const coarse: string[] = [];
    for (let i = 0; i < 512; i += 8) coarse.push(`${seedPoint(i, 64).lon}`);

    const fine = new Set<string>();
    for (let i = 0; i < 512; i += 4) fine.add(`${seedPoint(i, 64).lon}`);

    for (const lon of coarse) expect(fine.has(lon)).toBe(true);
  });

  it('donne des tirages stables et distincts', () => {
    const a = seedPoint(10, 20);
    expect(a.r1).not.toBe(a.r2);
    expect(a.r2).not.toBe(a.r3);
    expect(seedPoint(10, 20).r3).toBe(a.r3);
  });

  it('ne range pas deux cases voisines au même endroit', () => {
    expect(seedPoint(10, 20).lon).not.toBe(seedPoint(11, 20).lon);
  });

  it('décale chaque point de moins d une demi-case de son rang', () => {
    for (const [i, j] of [
      [1, 1],
      [8, 16],
      [64, 128],
      [1023, 7],
    ] as const) {
      const spread = spreadOf(i, j);
      const point = seedPoint(i, j);
      expect(Math.abs(point.lon - (i + 0.5) * FINE_STEP_DEG)).toBeLessThanOrEqual(spread / 2);
      expect(Math.abs(point.lat - (j + 0.5) * FINE_STEP_DEG)).toBeLessThanOrEqual(spread / 2);
    }
  });
});

describe('rang d apparition', () => {
  it('donne un rang élevé aux points des pas larges', () => {
    expect(appearanceLevel(8, 16)).toBe(3);
    expect(appearanceLevel(4, 8)).toBe(2);
    expect(appearanceLevel(3, 6)).toBe(0);
  });

  it('retient le plus petit des deux axes', () => {
    expect(appearanceLevel(16, 2)).toBe(1);
  });

  it('gère les indices négatifs', () => {
    expect(appearanceLevel(-8, -16)).toBe(3);
  });
});

describe('hash de case', () => {
  it('reste dans [0, 1[', () => {
    for (let i = -50; i < 50; i += 1) {
      const h = hashCell(i, i * 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('est reproductible', () => {
    expect(hashCell(42, -17)).toBe(hashCell(42, -17));
  });
});

import { describe, expect, it } from 'vitest';
import { computeHydro, resetHydroBuffers, DRY } from '@/hydro';
import { extractRivers, riverWidth } from '@/hydro/rivers';
import type { RasterSize } from '@/model/world';

function toGrid(rows: readonly (readonly number[])[]): {
  size: RasterSize;
  height: Float32Array;
} {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[y * width + x] = rows[y]![x]!;
  }
  return { size: { width, height }, height: data };
}

/** Nombre de polylignes décrites par le tableau d'index. */
function riverCount(starts: Int32Array): number {
  return Math.max(0, starts.length - 1);
}

describe('extraction des rivières', () => {
  it('suit une pente en une seule polyligne continue', () => {
    resetHydroBuffers();
    // Une gouttière : une colonne basse au milieu de deux crêtes, qui descend
    // vers le sud.
    const rows = Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 8 }, (_, x) => (x === 4 ? 70 - y * 10 : 90 - y * 10)),
    );
    const { size, height } = toGrid(rows);
    const state = computeHydro({ size, heightWorld: height, seaLevelM: -1000, rainPerCell: 1 });

    const isWater = new Uint8Array(size.width * size.height);
    for (let i = 0; i < isWater.length; i += 1) {
      isWater[i] = state.waterLevel[i]! > DRY ? 1 : 0;
    }

    const network = extractRivers(size, state.flowAcc, state.flowDir, isWater, 3);
    expect(riverCount(network.starts)).toBeGreaterThan(0);

    // Chaque polyligne porte au moins deux points et des largeurs positives.
    for (let r = 0; r < riverCount(network.starts); r += 1) {
      const from = network.starts[r]!;
      const to = network.starts[r + 1]!;
      expect(to - from).toBeGreaterThanOrEqual(2);
      for (let p = from; p < to; p += 1) {
        expect(network.points[p * 3 + 2]).toBeGreaterThan(0);
      }
    }
  });

  it('ne coupe pas une rivière qui franchit le méridien ±180', () => {
    resetHydroBuffers();
    // Le relief descend vers l'est en traversant la couture : la longitude
    // dépliée doit rester continue, sans saut de 360°.
    const width = 8;
    const rows = Array.from({ length: 4 }, () =>
      Array.from({ length: width }, (_, x) => 100 - ((x + 4) % width) * 10),
    );
    const { size, height } = toGrid(rows);
    const state = computeHydro({ size, heightWorld: height, seaLevelM: -1000, rainPerCell: 1 });

    const isWater = new Uint8Array(size.width * size.height);
    const network = extractRivers(size, state.flowAcc, state.flowDir, isWater, 2);

    for (let r = 0; r < riverCount(network.starts); r += 1) {
      const from = network.starts[r]!;
      const to = network.starts[r + 1]!;
      for (let p = from + 1; p < to; p += 1) {
        const step = Math.abs(network.points[p * 3]! - network.points[(p - 1) * 3]!);
        // Deux points voisins sont à une cellule l'un de l'autre : 45° ici.
        // Un saut de 360° signalerait une couture non dépliée.
        expect(step).toBeLessThan(90);
      }
    }
  });

  it('ne produit rien quand aucun écoulement n atteint le seuil', () => {
    resetHydroBuffers();
    const rows = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, () => 80 - y * 10));
    const { size, height } = toGrid(rows);
    const state = computeHydro({ size, heightWorld: height, seaLevelM: -1000, rainPerCell: 1 });
    const isWater = new Uint8Array(size.width * size.height);

    const network = extractRivers(size, state.flowAcc, state.flowDir, isWater, 1e9);
    expect(riverCount(network.starts)).toBe(0);
  });
});

describe('largeur du trait', () => {
  it('croît comme la racine du débit', () => {
    expect(riverWidth(4, 1)).toBeCloseTo(2);
    expect(riverWidth(16, 1)).toBeCloseTo(4);
  });

  it('est plafonnée pour éviter les fleuves démesurés', () => {
    expect(riverWidth(1e6, 1)).toBe(6);
  });
});

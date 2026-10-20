import { describe, expect, it } from 'vitest';
import { findRoadPath, type LonLat, type RoadPathOptions } from '@/gen/roadPath';
import { columnOfLon, idx, latOfRow, lonOfColumn, rowOfLat } from '@/model/coords';
import type { RasterSize } from '@/model/world';

const size: RasterSize = { width: 64, height: 32 };
// Petite planète : sur 64 × 32 cellules, des cellules d'une dizaine de km, comme
// celles d'un relief 2048 × 1024 sur une planète de taille terrestre.
const options: RoadPathOptions = { radiusKm: 100, seaLevelM: 0 };

/** Centre de la cellule (x, y), en [lonLocal, lat]. */
const at = (x: number, y: number): LonLat => [lonOfColumn(x, size.width), latOfRow(y, size.height)];

const cellOf = (p: LonLat): [number, number] => [
  columnOfLon(p[0], size.width),
  rowOfLat(p[1], size.height),
];

function plain(heightM: number): Float32Array {
  return new Float32Array(size.width * size.height).fill(heightM);
}

/** Colonnes traversées par le chemin, segment par segment, au pas d'une cellule. */
function cellsAlong(path: readonly LonLat[]): [number, number][] {
  const cells: [number, number][] = [];
  for (let k = 1; k < path.length; k += 1) {
    const [ax, ay] = cellOf(path[k - 1]!);
    const [bx, by] = cellOf(path[k]!);
    let dx = bx - ax;
    if (dx > size.width / 2) dx -= size.width;
    if (dx < -size.width / 2) dx += size.width;
    const steps = Math.max(Math.abs(dx), Math.abs(by - ay), 1);
    for (let s = 0; s <= steps; s += 1) {
      const x = Math.round(ax + (dx * s) / steps);
      cells.push([
        ((x % size.width) + size.width) % size.width,
        Math.round(ay + ((by - ay) * s) / steps),
      ]);
    }
  }
  return cells;
}

describe('tracé de moindre coût', () => {
  it('va droit sur une plaine, et rend les extrémités exactes', () => {
    const from: LonLat = [-40.3, 2.1];
    const to: LonLat = [-10.7, 2.4];
    const path = findRoadPath(size, plain(100), from, to, options)!;
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
    // Une ligne droite simplifiée n'a pas de point intermédiaire.
    expect(path.length).toBe(2);
  });

  // Une muraille à x = 32, percée d'un col en y = 26 :
  //   x:   28 .. 32 .. 36
  //   y=16  .   #   .        départ (28, 16), arrivée (36, 16)
  //   y=26  .   _   .        col à 100 m, muraille à 3000 m
  it('contourne une crête par le col', () => {
    const h = plain(100);
    for (let y = 0; y < size.height; y += 1) {
      if (y !== 26) h[idx(32, y, size.width)] = 3000;
    }
    const path = findRoadPath(size, h, at(28, 16), at(36, 16), options)!;
    const crossing = cellsAlong(path).filter(([x]) => x === 32);
    expect(crossing.length).toBeGreaterThan(0);
    for (const [, y] of crossing) expect(y).toBe(26);
  });

  it('préfère un détour à terre plutôt que la traversée d un bras de mer', () => {
    // Un bras de mer de x = 30 à 34, sur toute la hauteur sauf un isthme en y = 4.
    const h = plain(50);
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 30; x <= 34; x += 1) if (y !== 4) h[idx(x, y, size.width)] = -200;
    }
    const path = findRoadPath(size, h, at(26, 10), at(38, 10), options)!;
    const wet = cellsAlong(path).filter(([x, y]) => h[idx(x, y, size.width)]! < 0);
    expect(wet).toEqual([]);
  });

  it('passe par la couture du méridien ±180 quand c est plus court', () => {
    const path = findRoadPath(size, plain(10), at(1, 16), at(62, 16), options)!;
    // Aucun point du tracé ne s'aventure vers le milieu de la carte.
    for (const [x] of cellsAlong(path)) expect(x < 4 || x > 59).toBe(true);
  });

  it('renonce quand la fenêtre dépasserait le plafond', () => {
    expect(
      findRoadPath(size, plain(10), at(0, 2), at(30, 30), { ...options, maxCells: 100 }),
    ).toBeUndefined();
  });
});

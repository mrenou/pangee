/**
 * Extraction des cours d'eau en polylignes.
 *
 * Tester `flowAcc` par pixel dans le shader donne des rivières en marches
 * d'escalier d'une cellule. Une carte de roman a des traits d'encre : on suit
 * donc l'écoulement sur la grille et on en sort des polylignes, que le rendu
 * trace à largeur variable. Voir docs/rendu.md.
 */

import { latOfRow, lonOfColumn, wrapLon } from '@/model/coords';
import { D8_DX, D8_DY, NO_FLOW } from '@/hydro/types';
import type { RasterSize } from '@/model/world';

export interface RiverNetwork {
  /** Triplets (lon, lat, largeur relative), en référentiel monde. */
  readonly points: Float32Array;
  /** Index du premier point de chaque polyligne, plus une sentinelle finale. */
  readonly starts: Int32Array;
}

/** Largeur relative maximale d'un trait, pour éviter les fleuves démesurés. */
const MAX_WIDTH = 6;

/** Au-delà, une polyligne est coupée : cela borne le coût du rendu. */
const MAX_POINTS_PER_RIVER = 4096;

export function extractRivers(
  size: RasterSize,
  flowAcc: Float32Array,
  flowDir: Uint8Array,
  isWater: Uint8Array,
  threshold: number,
): RiverNetwork {
  const { width, height } = size;
  const cells = width * height;

  const isRiver = new Uint8Array(cells);
  const upstreamCount = new Uint8Array(cells);

  for (let i = 0; i < cells; i += 1) {
    isRiver[i] = flowAcc[i]! > threshold && isWater[i] === 0 ? 1 : 0;
  }

  // Combien d'affluents chaque cellule reçoit-elle ? Une cellule sans affluent
  // est une source, et c'est de là qu'on part.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (isRiver[index] === 0) continue;
      const d = flowDir[index]!;
      if (d === NO_FLOW) continue;
      const ny = y + D8_DY[d]!;
      if (ny < 0 || ny >= height) continue;
      let nx = x + D8_DX[d]!;
      if (nx < 0) nx = width - 1;
      else if (nx >= width) nx = 0;
      const downstream = ny * width + nx;
      if (isRiver[downstream] === 1 && upstreamCount[downstream]! < 255) {
        upstreamCount[downstream] = upstreamCount[downstream]! + 1;
      }
    }
  }

  const points: number[] = [];
  const starts: number[] = [];
  const traced = new Uint8Array(cells);

  for (let seed = 0; seed < cells; seed += 1) {
    if (isRiver[seed] === 0 || upstreamCount[seed] !== 0) continue;

    starts.push(points.length / 3);

    let index = seed;
    let previousLon = Number.NaN;
    let count = 0;

    for (;;) {
      const x = index % width;
      const y = (index - x) / width;

      // Dépliage : une rivière qui franchit le méridien ±180 doit rester une
      // ligne continue, sinon elle traverserait la carte de part en part.
      let lon = lonOfColumn(x, width);
      if (!Number.isNaN(previousLon)) lon = previousLon + wrapLon(lon - previousLon);
      previousLon = lon;

      points.push(lon, latOfRow(y, height), riverWidth(flowAcc[index]!, threshold));
      count += 1;

      const alreadyTraced = traced[index] === 1;
      traced[index] = 1;

      // On s'arrête à la mer, au lac, ou sur un tronçon déjà tracé : le trait
      // aval existe alors déjà, et l'affluent n'a qu'à le rejoindre.
      if (isWater[index] === 1 || alreadyTraced || count >= MAX_POINTS_PER_RIVER) break;

      const d = flowDir[index]!;
      if (d === NO_FLOW) break;
      const ny = y + D8_DY[d]!;
      if (ny < 0 || ny >= height) break;
      let nx = x + D8_DX[d]!;
      if (nx < 0) nx = width - 1;
      else if (nx >= width) nx = 0;
      index = ny * width + nx;
    }

    // Un point isolé ne fait pas un trait.
    if (count < 2) {
      points.length = starts[starts.length - 1]! * 3;
      starts.pop();
    }
  }

  starts.push(points.length / 3);

  return { points: new Float32Array(points), starts: new Int32Array(starts) };
}

/** Largeur relative d'un trait : le débit croît comme la surface drainée. */
export function riverWidth(flowAcc: number, threshold: number): number {
  return Math.min(MAX_WIDTH, Math.sqrt(flowAcc / threshold));
}

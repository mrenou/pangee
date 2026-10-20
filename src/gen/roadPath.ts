/**
 * Tracé de moindre coût entre deux points, sur la grille locale.
 *
 * Sert l'option « suivre le relief » de l'outil route, et servira le réseau
 * routier de la génération : même coût, même grille. Le coût d'un pas croît
 * avec la pente et devient prohibitif sous la mer, de sorte que la route
 * contourne les crêtes et longe les côtes plutôt que de les couper.
 * Voir docs/editeur.md et docs/generation.md.
 */

import { MinHeap } from '@/hydro/heap';
import {
  columnOfLon,
  kmPerDegLat,
  kmPerDegLon,
  latOfRow,
  lonOfColumn,
  rowOfLat,
  wrapX,
} from '@/model/coords';
import type { RasterSize } from '@/model/world';

export type LonLat = readonly [number, number];

export interface RoadPathOptions {
  readonly radiusKm: number;
  readonly seaLevelM: number;
  /**
   * Plafond de cellules de la fenêtre de recherche. Au-delà, aucune
   * proposition : le calcul tourne sur le thread principal, au clic.
   */
  readonly maxCells?: number;
}

/** Surcoût par unité de pente (mètres de dénivelé par mètre parcouru). */
export const SLOPE_WEIGHT = 150;
/** Surcoût d'un pas sous la mer, en multiple de sa longueur. */
export const WATER_WEIGHT = 30;
/** Fenêtre par défaut : environ 0,6 M de cellules, quelques dizaines de ms. */
export const DEFAULT_MAX_CELLS = 600_000;

const NEIGHBOURS_DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const NEIGHBOURS_DY = [0, 0, 1, -1, 1, -1, 1, -1] as const;

/**
 * Chemin de moindre coût de `from` à `to`, en points `[lonLocal, lat]`.
 *
 * Les extrémités sont rendues exactement — un tracé accroché à une ville en
 * part exactement. Les points intermédiaires sont des centres de cellules,
 * débarrassés des alignements par une simplification à une cellule près.
 * `undefined` si les points sont trop éloignés pour la fenêtre autorisée.
 *
 * La recherche est bornée à une fenêtre englobant les deux points avec une
 * marge, prise du côté le plus court du cylindre : la longitude se wrap, la
 * latitude se borne.
 */
export function findRoadPath(
  size: RasterSize,
  height: Float32Array,
  from: LonLat,
  to: LonLat,
  options: RoadPathOptions,
): readonly LonLat[] | undefined {
  const { width, height: rows } = size;
  const fx = columnOfLon(from[0], width);
  const fy = rowOfLat(from[1], rows);
  const tx = columnOfLon(to[0], width);
  const ty = rowOfLat(to[1], rows);

  // Abscisses « déroulées » : u = 0 sur la colonne de départ, l'arrivée du
  // côté le plus court.
  let du = (((tx - fx) % width) + width) % width;
  if (du > width / 2) du -= width;
  const dy = ty - fy;

  if (du === 0 && dy === 0) return [from, to];

  // Marge égale à l'écart entre les points : un détour par un col situé à
  // côté du trajet direct reste dans la fenêtre.
  const margin = Math.max(16, Math.abs(du), Math.abs(dy));
  const u0 = Math.min(0, du) - margin;
  const w = Math.max(0, du) + margin - u0 + 1;
  const y0 = Math.max(0, Math.min(fy, ty) - margin);
  const h = Math.min(rows - 1, Math.max(fy, ty) + margin) - y0 + 1;

  // Une fenêtre plus large que la planète visiterait deux fois les mêmes
  // cellules sous deux noms.
  if (w >= width || w * h > (options.maxCells ?? DEFAULT_MAX_CELLS)) return undefined;

  // Longueur d'un pas, en km, selon la ligne : les méridiens se resserrent
  // vers les pôles.
  const degX = 360 / width;
  const kmY = kmPerDegLat(options.radiusKm) * (180 / rows);
  const kmX = new Float64Array(h);
  let minKmX = Infinity;
  for (let j = 0; j < h; j += 1) {
    const km = kmPerDegLon(latOfRow(y0 + j, rows), options.radiusKm) * degX;
    kmX[j] = km;
    if (km < minKmX) minKmX = km;
  }

  const cells = w * h;
  const cost = new Float64Array(cells).fill(Infinity);
  const came = new Int32Array(cells).fill(-1);
  const closed = new Uint8Array(cells);
  const heap = new MinHeap(1024);

  const start = (fy - y0) * w + (0 - u0);
  const goal = (ty - y0) * w + (du - u0);
  const goalI = du - u0;
  const goalJ = ty - y0;
  const seaLevelM = options.seaLevelM;

  const heightAt = (i: number, j: number): number =>
    // i et j sont bornés à la fenêtre, et la fenêtre à la planète.
    height[(y0 + j) * width + wrapX(fx + u0 + i, width)]!;

  cost[start] = 0;
  heap.push(0, start);

  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current] === 1) continue;
    closed[current] = 1;
    if (current === goal) break;

    const ci = current % w;
    const cj = (current - ci) / w;
    const ch = heightAt(ci, cj);
    const cCost = cost[current]!;

    for (let k = 0; k < 8; k += 1) {
      const ni = ci + NEIGHBOURS_DX[k]!;
      const nj = cj + NEIGHBOURS_DY[k]!;
      if (ni < 0 || ni >= w || nj < 0 || nj >= h) continue;
      const next = nj * w + ni;
      if (closed[next] === 1) continue;

      const nh = heightAt(ni, nj);
      const stepKm = Math.hypot(NEIGHBOURS_DX[k]! * kmX[cj]!, NEIGHBOURS_DY[k]! * kmY);
      const slope = Math.abs(nh - ch) / (stepKm * 1000);
      let step = stepKm * (1 + SLOPE_WEIGHT * slope);
      if (nh < seaLevelM) step += stepKm * WATER_WEIGHT;

      const candidate = cCost + step;
      if (candidate < cost[next]!) {
        cost[next] = candidate;
        came[next] = current;
        // Heuristique admissible : la ligne droite au plus petit pas en
        // longitude de la fenêtre, sans pente ni eau.
        const remaining = Math.hypot((goalI - ni) * minKmX, (goalJ - nj) * kmY);
        heap.push(candidate + remaining, next);
      }
    }
  }

  if (came[goal] === -1) return undefined;

  // Remontée du chemin, de l'arrivée au départ.
  const us: number[] = [];
  const ys: number[] = [];
  for (let c = goal; c !== -1; c = came[c]!) {
    const i = c % w;
    us.push(i + u0);
    ys.push((c - i) / w + y0);
  }
  us.reverse();
  ys.reverse();

  const kept = simplify(us, ys, 1);
  const points: LonLat[] = [from];
  for (let k = 1; k < kept.length - 1; k += 1) {
    const n = kept[k]!;
    points.push([lonOfColumn(wrapX(fx + us[n]!, width), width), latOfRow(ys[n]!, rows)]);
  }
  points.push(to);
  return points;
}

/**
 * Douglas–Peucker sur une polyligne de cellules : indices des points gardés.
 * Un escalier de cellules devient quelques segments droits.
 */
function simplify(us: readonly number[], ys: readonly number[], tolerance: number): number[] {
  const keep = new Uint8Array(us.length);
  keep[0] = 1;
  keep[us.length - 1] = 1;

  const stack: [number, number][] = [[0, us.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const ax = us[a]!;
    const ay = ys[a]!;
    const bx = us[b]!;
    const by = ys[b]!;
    const length = Math.hypot(bx - ax, by - ay) || 1;

    let farthest = -1;
    let farthestDistance = tolerance;
    for (let k = a + 1; k < b; k += 1) {
      const d = Math.abs((bx - ax) * (ay - ys[k]!) - (ax - us[k]!) * (by - ay)) / length;
      if (d > farthestDistance) {
        farthestDistance = d;
        farthest = k;
      }
    }

    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([a, farthest], [farthest, b]);
    }
  }

  const kept: number[] = [];
  for (let k = 0; k < keep.length; k += 1) if (keep[k] === 1) kept.push(k);
  return kept;
}

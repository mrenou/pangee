/**
 * Détection des lacs : les cellules que le remplissage a noyées.
 *
 * Un lac n'est pas cherché, il est constaté — c'est ce que le priority-flood a
 * relevé au-dessus du terrain. Voir docs/hydrologie.md.
 */

import { wrapX } from '@/model/coords';
import { D8_DX, D8_DY, DRY, EPSILON_M, NO_FLOW, type Lake } from '@/hydro/types';
import type { RasterSize } from '@/model/world';

export interface LakeResult {
  readonly lakes: readonly Lake[];
  readonly lakeId: Int32Array;
  readonly waterLevel: Float32Array;
}

/** Marge au-dessus de laquelle on considère qu'une cellule a été noyée. */
const FLOODED_MARGIN_M = EPSILON_M * 2;

/**
 * Profondeur en deçà de laquelle une cuvette remplie n'est pas un lac.
 *
 * Un relief de bruit fractal compte des milliers de minima locaux d'un ou deux
 * mètres. Le remplissage les traite correctement — ils comptent pour
 * l'écoulement — mais les afficher en eau criblerait la carte de taches. Le
 * critère est la profondeur et non la surface : une cellule fait déjà une
 * vingtaine de kilomètres, la surface ne discrimine rien.
 */
export const MIN_LAKE_DEPTH_M = 25;

/**
 * Nombre minimal de cellules. Une cellule couvre déjà une vingtaine de
 * kilomètres : un « lac » d'une seule cellule est un artefact du bruit, pas une
 * étendue d'eau. Le relief à crêtes en produit des milliers.
 */
export const MIN_LAKE_CELLS = 3;

/** Marqueur interne : cellule déjà parcourue, dans un lac non retenu. */
const REJECTED = -1;

export function findLakes(
  size: RasterSize,
  heightWorld: Float32Array,
  filled: Float32Array,
  isOcean: Uint8Array,
  flowAcc: Float32Array,
  flowDir: Uint8Array,
  lakeId: Int32Array,
  waterLevel: Float32Array,
  stack: Int32Array,
): LakeResult {
  const { width, height } = size;
  const cells = width * height;

  lakeId.fill(0);
  const lakes: Lake[] = [];

  for (let index = 0; index < cells; index += 1) {
    waterLevel[index] = isOcean[index] === 1 ? filled[index]! : DRY;
  }

  for (let seed = 0; seed < cells; seed += 1) {
    if (
      lakeId[seed] !== 0 ||
      isOcean[seed] === 1 ||
      filled[seed]! <= heightWorld[seed]! + FLOODED_MARGIN_M
    ) {
      continue;
    }

    // Marqueur provisoire : il empêche le parcours de repasser sur ses pas.
    // L'identifiant définitif n'est attribué qu'une fois le lac retenu.
    const id = REJECTED;
    const level = filled[seed]!;
    let head = 0;
    let tail = 0;
    stack[tail] = seed;
    tail += 1;
    lakeId[seed] = id;

    let inflow = 0;
    let outletIndex = -1;
    let outletAcc = -1;
    let deepest = Infinity;

    while (head < tail) {
      const index = stack[head]!;
      head += 1;
      if (heightWorld[index]! < deepest) deepest = heightWorld[index]!;

      const x = index % width;
      const y = (index - x) / width;

      for (let d = 0; d < 8; d += 1) {
        const ny = y + D8_DY[d]!;
        if (ny < 0 || ny >= height) continue;
        let nx = x + D8_DX[d]!;
        if (nx < 0) nx = width - 1;
        else if (nx >= width) nx = 0;
        const neighbour = ny * width + nx;

        const neighbourFlooded =
          isOcean[neighbour] === 0 &&
          filled[neighbour]! > heightWorld[neighbour]! + FLOODED_MARGIN_M;

        // Même plan d'eau : même niveau, à la tolérance du remplissage près.
        if (neighbourFlooded && Math.abs(filled[neighbour]! - level) <= FLOODED_MARGIN_M) {
          if (lakeId[neighbour] === 0) {
            lakeId[neighbour] = id;
            stack[tail] = neighbour;
            tail += 1;
          }
          continue;
        }

        // Voisin sec ou marin : une rive. S'il reçoit de l'eau du lac, c'est
        // l'exutoire ; s'il en apporte, c'est un affluent.
        if (flowDir[index] !== NO_FLOW && isDownstream(index, neighbour, flowDir, width, height)) {
          if (flowAcc[index]! > outletAcc) {
            outletAcc = flowAcc[index]!;
            outletIndex = neighbour;
          }
        } else if (isDownstream(neighbour, index, flowDir, width, height)) {
          inflow += flowAcc[neighbour]!;
        }
      }
    }

    const depthM = level - deepest;

    if (depthM < MIN_LAKE_DEPTH_M || tail < MIN_LAKE_CELLS) {
      // Simple creux du bruit : on le laisse rempli pour l'écoulement, mais on
      // ne le montre pas comme un plan d'eau. Les cellules gardent le marqueur
      // de rejet — les remettre à zéro les ferait revisiter indéfiniment.
      continue;
    }

    for (let i = 0; i < tail; i += 1) {
      lakeId[stack[i]!] = lakes.length + 1;
      waterLevel[stack[i]!] = level;
    }

    lakes.push({
      id: lakes.length + 1,
      levelM: level,
      depthM,
      cellCount: tail,
      outletIndex,
      inflow,
    });
  }

  // Le marqueur de rejet a joué son rôle : la couche publique ne connaît que
  // 0 (pas de lac) et les identifiants des lacs retenus.
  for (let index = 0; index < cells; index += 1) {
    if (lakeId[index] === REJECTED) lakeId[index] = 0;
  }

  return { lakes, lakeId, waterLevel };
}

/** La cellule `from` s'écoule-t-elle directement dans `to` ? */
function isDownstream(
  from: number,
  to: number,
  flowDir: Uint8Array,
  width: number,
  height: number,
): boolean {
  const d = flowDir[from]!;
  if (d === NO_FLOW) return false;

  const x = from % width;
  const y = (from - x) / width;
  const ny = y + D8_DY[d]!;
  if (ny < 0 || ny >= height) return false;

  return ny * width + wrapX(x + D8_DX[d]!, width) === to;
}

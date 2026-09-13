/**
 * Directions d'écoulement D8 et accumulation de la pluie.
 *
 * D8 plutôt que D-infinity : les rivières d'une carte de roman sont des traits
 * d'encre, pas des nappes de ruissellement. Voir docs/hydrologie.md.
 */

import { D8_DX, D8_DY, D8_LENGTH, NO_FLOW } from '@/hydro/types';
import type { RasterSize } from '@/model/world';

/**
 * Chaque cellule pointe vers le voisin de plus forte pente descendante, sur le
 * relief rempli. Les bords nord et sud sont des exutoires, la longitude wrappe.
 */
export function computeFlowDir(
  size: RasterSize,
  filled: Float32Array,
  isOcean: Uint8Array,
  out: Uint8Array,
): Uint8Array {
  const { width, height } = size;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;

    for (let x = 0; x < width; x += 1) {
      const index = row + x;

      if (isOcean[index] === 1) {
        out[index] = NO_FLOW;
        continue;
      }

      const here = filled[index]!;
      let best = NO_FLOW;
      let bestSlope = 0;
      let borderExit = NO_FLOW;

      for (let d = 0; d < 8; d += 1) {
        const ny = y + D8_DY[d]!;
        if (ny < 0 || ny >= height) {
          // Le monde n'est fermé qu'en longitude : les pôles sont des
          // exutoires. Mais sortir par là ne doit jamais primer sur une pente
          // intérieure, sinon toute la première ligne s'écoulerait vers le
          // pôle au lieu de descendre.
          borderExit = d;
          continue;
        }

        // Wrap écrit à la main : voir la note dans priorityFlood.
        let nx = x + D8_DX[d]!;
        if (nx < 0) nx = width - 1;
        else if (nx >= width) nx = 0;
        const drop = here - filled[ny * width + nx]!;
        if (drop <= 0) continue;

        const slope = drop / D8_LENGTH[d]!;
        if (slope > bestSlope) {
          bestSlope = slope;
          best = d;
        }
      }

      out[index] = best === NO_FLOW ? borderExit : best;
    }
  }

  return out;
}

/**
 * Propage la pluie de l'amont vers l'aval en une seule passe.
 *
 * L'ordre de sortie du priority-flood est croissant en altitude, donc le
 * parcourir à l'envers va de l'amont vers l'aval : chaque cellule est traitée
 * avant celle qui la reçoit. Ni récursion, ni file de travail.
 */
export function accumulateFlow(
  size: RasterSize,
  order: Int32Array,
  flowDir: Uint8Array,
  rainPerCell: number,
  out: Float32Array,
): Float32Array {
  const { width, height } = size;
  out.fill(rainPerCell);

  for (let i = order.length - 1; i >= 0; i -= 1) {
    const index = order[i]!;
    const d = flowDir[index]!;
    if (d === NO_FLOW) continue;

    const x = index % width;
    const y = (index - x) / width;
    const ny = y + D8_DY[d]!;
    if (ny < 0 || ny >= height) continue;

    let nx = x + D8_DX[d]!;
    if (nx < 0) nx = width - 1;
    else if (nx >= width) nx = 0;
    const downstream = ny * width + nx;
    out[downstream] = out[downstream]! + out[index]!;
  }

  return out;
}

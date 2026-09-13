/**
 * Pipeline hydrologique complet.
 *
 * La signature accepte déjà `prev` et `dtDays`, que la v1 ignore : l'eau y est
 * à l'équilibre instantané. La v2 volumétrique s'y branchera sans casser un
 * seul appelant. Voir docs/hydrologie.md.
 */

import { accumulateFlow, computeFlowDir } from '@/hydro/flow';
import { findLakes } from '@/hydro/lakes';
import { createFloodBuffers, priorityFlood, type FloodBuffers } from '@/hydro/priorityFlood';
import type { HydroInput, HydroState } from '@/hydro/types';
import type { RasterSize } from '@/model/world';

interface HydroBuffers extends FloodBuffers {
  flowDir: Uint8Array;
  flowAcc: Float32Array;
  lakeId: Int32Array;
  waterLevel: Float32Array;
  scratch: Int32Array;
}

let buffers: HydroBuffers | undefined;

/**
 * Tampons réutilisés d'un appel à l'autre : sur deux millions de cellules,
 * réallouer coûterait plus cher que l'algorithme.
 */
function ensureBuffers(size: RasterSize): HydroBuffers {
  const cells = size.width * size.height;
  if (!buffers || buffers.filled.length !== cells) {
    buffers = {
      ...createFloodBuffers(size),
      flowDir: new Uint8Array(cells),
      flowAcc: new Float32Array(cells),
      lakeId: new Int32Array(cells),
      waterLevel: new Float32Array(cells),
      scratch: new Int32Array(cells),
    };
  }
  return buffers;
}

export function computeHydro(input: HydroInput, _prev?: HydroState, _dtDays?: number): HydroState {
  const { size, heightWorld, seaLevelM, rainPerCell } = input;
  const b = ensureBuffers(size);

  const { filled, order, isOcean } = priorityFlood(size, heightWorld, seaLevelM, b);
  const flowDir = computeFlowDir(size, filled, isOcean, b.flowDir);
  const flowAcc = accumulateFlow(size, order, flowDir, rainPerCell, b.flowAcc);
  const { lakes, lakeId, waterLevel } = findLakes(
    size,
    heightWorld,
    filled,
    isOcean,
    flowAcc,
    flowDir,
    b.lakeId,
    b.waterLevel,
    b.scratch,
  );

  return { size, filled, flowDir, flowAcc, waterLevel, lakeId, isOcean, lakes };
}

/** Libère les tampons. Utile aux tests, qui changent de taille de grille. */
export function resetHydroBuffers(): void {
  buffers = undefined;
}

/**
 * Seuil au-delà duquel un écoulement se dessine comme une rivière, exprimé en
 * fraction de la surface de la planète : changer de résolution ne doit pas
 * effacer les rivières.
 */
export const RIVER_THRESHOLD_FRACTION = 0.0002;

export function riverThreshold(size: RasterSize, rainPerCell: number): number {
  return size.width * size.height * RIVER_THRESHOLD_FRACTION * rainPerCell;
}

export { assembleHeightWorld, rowShiftCells } from '@/hydro/assemble';
export * from '@/hydro/types';

/**
 * Remplissage des dépressions par priority-flood (Barnes, Lehman & Mulla 2014),
 * adapté au cylindre : le wrap est-ouest fait partie du voisinage.
 *
 * Toute cuvette fermée est remplie exactement jusqu'à sa cote de débordement.
 * C'est ce qui fait qu'une rivière barrée par un anneau qui a glissé produit un
 * lac sans la moindre ligne de code dédiée. Voir docs/hydrologie.md.
 */

import { MinHeap } from '@/hydro/heap';
import { D8_DX, D8_DY, EPSILON_M } from '@/hydro/types';
import type { RasterSize } from '@/model/world';

export interface FloodResult {
  /** Relief sans dépression : filled >= heightWorld partout. */
  readonly filled: Float32Array;
  /** Ordre de sortie de la file, croissant en altitude. Tri topologique. */
  readonly order: Int32Array;
  /** 1 si la cellule appartient à une mer. */
  readonly isOcean: Uint8Array;
}

export interface FloodBuffers {
  filled: Float32Array;
  order: Int32Array;
  isOcean: Uint8Array;
  visited: Uint8Array;
  heap: MinHeap;
}

export function createFloodBuffers(size: RasterSize): FloodBuffers {
  const cells = size.width * size.height;
  return {
    filled: new Float32Array(cells),
    order: new Int32Array(cells),
    isOcean: new Uint8Array(cells),
    visited: new Uint8Array(cells),
    heap: new MinHeap(Math.max(1024, Math.ceil(cells / 4))),
  };
}

/**
 * Marque les mers : composantes connexes sous le niveau de la mer reliées au
 * bord du monde ou dépassant un seuil de surface. Une mer intérieure reste une
 * mer ; une flaque trop petite sera traitée comme un lac par l'étape suivante.
 */
function markOceans(
  size: RasterSize,
  heightWorld: Float32Array,
  seaLevelM: number,
  isOcean: Uint8Array,
  visited: Uint8Array,
  stack: Int32Array,
): void {
  const { width, height } = size;
  const cells = width * height;
  isOcean.fill(0);
  visited.fill(0);

  // Seuil de surface : une composante d'eau au-dessous est une flaque, pas une
  // mer. Exprimé en fraction de la planète, pas en nombre de cellules, pour
  // que changer de résolution ne change pas la carte.
  const minOceanCells = Math.max(4, Math.floor(cells * 0.0005));

  // Parcours en largeur : la file occupe stack[0..tail[, et une fois la
  // composante épuisée ces mêmes indices sont exactement ses cellules. Aucune
  // liste intermédiaire n'est allouée.
  for (let seed = 0; seed < cells; seed += 1) {
    if (visited[seed] === 1 || heightWorld[seed]! >= seaLevelM) continue;

    let head = 0;
    let tail = 0;
    stack[tail] = seed;
    tail += 1;
    visited[seed] = 1;

    while (head < tail) {
      const index = stack[head]!;
      head += 1;

      const x = index % width;
      const y = (index - x) / width;

      // 4-connexité : deux mers qui ne se touchent qu'en diagonale restent
      // distinctes, ce qui évite de faire fuir l'eau à travers un isthme.
      for (let d = 0; d < 8; d += 2) {
        const ny = y + D8_DY[d]!;
        if (ny < 0 || ny >= height) continue;
        // Wrap écrit à la main : le décalage ne vaut que -1, 0 ou 1, un modulo
        // serait un coût inutile sur seize millions d'appels.
        let nx = x + D8_DX[d]!;
        if (nx < 0) nx = width - 1;
        else if (nx >= width) nx = 0;
        const neighbour = ny * width + nx;
        if (visited[neighbour] === 1 || heightWorld[neighbour]! >= seaLevelM) continue;
        visited[neighbour] = 1;
        stack[tail] = neighbour;
        tail += 1;
      }
    }

    if (tail >= minOceanCells) {
      for (let i = 0; i < tail; i += 1) isOcean[stack[i]!] = 1;
    }
  }
}

/**
 * Remplit les dépressions. Le résultat réutilise les tampons fournis.
 */
export function priorityFlood(
  size: RasterSize,
  heightWorld: Float32Array,
  seaLevelM: number,
  buffers: FloodBuffers,
): FloodResult {
  const { width, height } = size;
  const cells = width * height;
  const { filled, order, isOcean, visited, heap } = buffers;

  // order sert ici de pile de parcours : il est intégralement réécrit juste
  // après, par la boucle principale.
  markOceans(size, heightWorld, seaLevelM, isOcean, visited, order);

  heap.clear();
  visited.fill(0);

  // Amorçage : les mers, à leur niveau, et les bords nord et sud, par lesquels
  // le monde s'écoule — le cylindre n'est fermé qu'en longitude.
  for (let index = 0; index < cells; index += 1) {
    if (isOcean[index] === 1) {
      filled[index] = seaLevelM;
      visited[index] = 1;
      heap.push(seaLevelM, index);
    }
  }

  const pushBorder = (index: number): void => {
    if (visited[index] === 1) return;
    visited[index] = 1;
    filled[index] = heightWorld[index]!;
    heap.push(filled[index], index);
  };

  for (let x = 0; x < width; x += 1) {
    pushBorder(x);
    pushBorder((height - 1) * width + x);
  }

  let processed = 0;

  while (heap.size > 0) {
    const index = heap.pop();
    order[processed] = index;
    processed += 1;

    const level = filled[index]!;
    const x = index % width;
    const y = (index - x) / width;

    for (let d = 0; d < 8; d += 1) {
      const ny = y + D8_DY[d]!;
      if (ny < 0 || ny >= height) continue;
      let nx = x + D8_DX[d]!;
      if (nx < 0) nx = width - 1;
      else if (nx >= width) nx = 0;
      const neighbour = ny * width + nx;
      if (visited[neighbour] === 1) continue;

      visited[neighbour] = 1;
      // Le cœur de l'algorithme : une cellule ne peut pas être plus basse que
      // le point par lequel on l'a atteinte. Une cuvette se remplit donc
      // exactement jusqu'à sa cote de débordement.
      const raised = Math.max(heightWorld[neighbour]!, level + EPSILON_M);
      filled[neighbour] = raised;
      heap.push(raised, neighbour);
    }
  }

  return { filled, order, isOcean };
}

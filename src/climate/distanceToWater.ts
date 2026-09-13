/**
 * Distance à l'eau la plus proche, en cellules.
 *
 * C'est elle qui creuse les intérieurs continentaux : loin de toute mer et de
 * tout lac, il pleut moins. Transformée de distance par chanfrein, deux passes,
 * avec wrap est-ouest. Voir docs/generation.md.
 */

import type { RasterSize } from '@/model/world';

/**
 * Coûts du chanfrein 3-4 : la distance euclidienne à environ 5 % près, en deux
 * passes linéaires. Largement assez fin pour décider d'un biome.
 */
const ORTHOGONAL = 3;
const DIAGONAL = 4;
const SCALE = 3;

/**
 * Renvoie, pour chaque cellule, la distance en cellules à l'eau la plus proche.
 * Les cellules d'eau sont à distance 0. Sans eau du tout, tout est à l'infini.
 */
export function distanceToWater(
  size: RasterSize,
  isWater: Uint8Array,
  out: Float32Array,
): Float32Array {
  const { width, height } = size;
  const cells = width * height;
  const INF = 1e9;

  for (let i = 0; i < cells; i += 1) out[i] = isWater[i] === 1 ? 0 : INF;

  const relax = (index: number, from: number, cost: number): void => {
    const candidate = out[from]! + cost;
    if (candidate < out[index]!) out[index] = candidate;
  };

  // Passe avant : haut vers bas, gauche vers droite.
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const up = row - width;
    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      if (out[index] === 0) continue;

      let left = x - 1;
      if (left < 0) left = width - 1;
      let right = x + 1;
      if (right >= width) right = 0;

      relax(index, row + left, ORTHOGONAL);
      if (y > 0) {
        relax(index, up + x, ORTHOGONAL);
        relax(index, up + left, DIAGONAL);
        relax(index, up + right, DIAGONAL);
      }
    }
  }

  // Passe arrière : bas vers haut, droite vers gauche.
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;
    const down = row + width;
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = row + x;
      if (out[index] === 0) continue;

      let left = x - 1;
      if (left < 0) left = width - 1;
      let right = x + 1;
      if (right >= width) right = 0;

      relax(index, row + right, ORTHOGONAL);
      if (y < height - 1) {
        relax(index, down + x, ORTHOGONAL);
        relax(index, down + left, DIAGONAL);
        relax(index, down + right, DIAGONAL);
      }
    }
  }

  // Le wrap impose une seconde paire de passes : une cellule de la colonne 0
  // peut être atteinte par la droite, information qu'une seule passe avant ne
  // propage jamais complètement autour du cylindre.
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let k = 0; k < width; k += 1) {
        const x = pass === 0 ? k : width - 1 - k;
        const index = row + x;
        let neighbour = pass === 0 ? x - 1 : x + 1;
        if (neighbour < 0) neighbour = width - 1;
        else if (neighbour >= width) neighbour = 0;
        relax(index, row + neighbour, ORTHOGONAL);
      }
    }
  }

  for (let i = 0; i < cells; i += 1) {
    if (out[i]! < INF) out[i] = out[i]! / SCALE;
  }

  return out;
}

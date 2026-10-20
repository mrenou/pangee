/**
 * Assemblage : le relief local devient le relief monde à la date t.
 *
 * Chaque ligne est décalée du Δλ de son anneau, converti en cellules et arrondi.
 * L'arrondi est assumé côté CPU — le rendu, lui, applique le décalage flottant
 * exact dans le shader. Voir docs/hydrologie.md et docs/rendu.md.
 */

import { latOfRow, wrapX } from '@/model/coords';
import type { RingConfig } from '@/model/ring';
import { offsetAtLat } from '@/model/time';
import type { RasterSize } from '@/model/world';

/**
 * Décalage d'une ligne, en cellules entières.
 * Fonction unique, utilisée partout côté CPU : deux arrondis différents
 * produiraient des artefacts d'un pixel le long des coupures.
 */
export function rowShiftCells(lat: number, cfg: RingConfig, tDays: number, width: number): number {
  const offsetDeg = offsetAtLat(lat, cfg, tDays);
  return Math.round((offsetDeg / 360) * width);
}

export function assembleHeightWorld(
  size: RasterSize,
  heightLocal: Float32Array,
  cfg: RingConfig,
  tDays: number,
  out: Float32Array = new Float32Array(size.width * size.height),
): Float32Array {
  return assembleLayerWorld(size, heightLocal, cfg, tDays, out);
}

/**
 * Assemble n'importe quelle couche locale — relief, override de biome — avec
 * le même arrondi que le relief : une forêt forcée par le MJ reste alignée
 * sur la colline où il l'a peinte.
 */
export function assembleLayerWorld<T extends Float32Array | Uint8Array>(
  size: RasterSize,
  local: T,
  cfg: RingConfig,
  tDays: number,
  out: T,
): T {
  const { width, height } = size;

  for (let y = 0; y < height; y += 1) {
    const shift = rowShiftCells(latOfRow(y, height), cfg, tDays, width);
    const row = y * width;

    // Une cellule affichée en x vient de la colonne locale x - shift.
    for (let x = 0; x < width; x += 1) {
      out[row + x] = local[row + wrapX(x - shift, width)]!;
    }
  }

  return out;
}

/**
 * Point d'entrée de la génération procédurale.
 * Le contrat exposé au worker et à ses tests. Voir docs/generation.md.
 */

import { generateHeight, type TerrainParams } from '@/gen/terrain';
import type { RasterSize } from '@/model/world';

export interface GenerateWorldRequest {
  readonly size: RasterSize;
  readonly terrain: TerrainParams;
}

export interface GenerateWorldResult {
  readonly size: RasterSize;
  readonly height: Float32Array;
  readonly biomeOverride: Uint8Array;
}

/**
 * Produit les couches locales d'un monde neuf.
 * `biomeOverride` est laissé à 0 : la génération produit du relief, les biomes
 * sont dérivés.
 */
export function generateWorld(request: GenerateWorldRequest): GenerateWorldResult {
  const { size, terrain } = request;
  return {
    size,
    height: generateHeight(size, terrain),
    biomeOverride: new Uint8Array(size.width * size.height),
  };
}

export { DEFAULT_TERRAIN_PARAMS, MAX_ALTITUDE_M, MAX_DEPTH_M } from '@/gen/terrain';
export type { TerrainParams } from '@/gen/terrain';

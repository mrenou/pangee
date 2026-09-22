/**
 * Point d'entrée de la génération procédurale.
 *
 * Le placement des lieux a besoin de savoir où coule l'eau : on lance donc une
 * passe d'hydrologie et de climat à t0, uniquement pour noter les cellules.
 * Ces couches ne sont pas conservées — elles seront recalculées à la date de
 * campagne par le worker hydrologique. Voir docs/generation.md.
 */

import { computeBiomes, createClimateBuffers } from '@/climate';
import { computeHydro, riverThreshold } from '@/hydro';
import { placePlaces } from '@/gen/places';
import { generateHeight, type TerrainParams } from '@/gen/terrain';
import { DEFAULT_RING_CONFIG, type RingConfig } from '@/model/ring';
import type { Place, RasterSize } from '@/model/world';

export interface GenerateWorldRequest {
  readonly size: RasterSize;
  readonly terrain: TerrainParams;
  /** 0 à 1 : environ cinquante lieux à 0, cent cinquante à 1. */
  readonly placeDensity: number;
  readonly seaLevelM: number;
  readonly radiusKm: number;
  readonly ringConfig: RingConfig;
}

export interface GenerateWorldResult {
  readonly size: RasterSize;
  readonly height: Float32Array;
  readonly biomeOverride: Uint8Array;
  readonly places: readonly Place[];
}

export const DEFAULT_PLACE_DENSITY = 0.5;

/**
 * Produit les couches locales d'un monde neuf et ses lieux.
 * `biomeOverride` est laissé à 0 : la génération produit du relief, les biomes
 * sont dérivés.
 */
export function generateWorld(request: GenerateWorldRequest): GenerateWorldResult {
  const { size, terrain, placeDensity, seaLevelM, radiusKm, ringConfig } = request;
  const height = generateHeight(size, terrain);

  // À t0 les anneaux sont alignés : le relief local est déjà le relief monde,
  // aucun assemblage n'est nécessaire pour cette passe d'amorçage.
  const rainPerCell = 1;
  const hydro = computeHydro({ size, heightWorld: height, seaLevelM, rainPerCell });
  const threshold = riverThreshold(size, rainPerCell);

  const biome = computeBiomes(
    {
      size,
      heightWorld: height,
      waterLevel: hydro.waterLevel,
      flowAcc: hydro.flowAcc,
      seaLevelM,
      riverThreshold: threshold,
      seed: terrain.seed,
    },
    createClimateBuffers(size),
  );

  const places = placePlaces({
    size,
    heightWorld: height,
    waterLevel: hydro.waterLevel,
    flowAcc: hydro.flowAcc,
    biome,
    seaLevelM,
    riverThreshold: threshold,
    radiusKm,
    ringConfig: ringConfig ?? DEFAULT_RING_CONFIG,
    seed: terrain.seed,
    placeDensity,
  });

  return {
    size,
    height,
    biomeOverride: new Uint8Array(size.width * size.height),
    places,
  };
}

export { DEFAULT_TERRAIN_PARAMS, MAX_ALTITUDE_M, MAX_DEPTH_M } from '@/gen/terrain';
export type { TerrainParams } from '@/gen/terrain';
export { targetPlaceCount, minDistanceKm, distanceKm } from '@/gen/places';
export { generateName, nameForPlace } from '@/gen/names';

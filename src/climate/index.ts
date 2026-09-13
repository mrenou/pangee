/**
 * Carte des biomes pour une date donnée.
 *
 * Entrées en référentiel monde (relief assemblé, eau calculée) plus l'override
 * du MJ, qui reste en référentiel local et est donc décalé ici comme le relief.
 * Voir docs/generation.md.
 */

import { createNoise3D } from 'simplex-noise';
import { fbmCylinder } from '@/gen/noise';
import { rngFor } from '@/gen/rng';
import { latOfRow, lonOfColumn } from '@/model/coords';
import { DRY } from '@/hydro/types';
import type { RasterSize } from '@/model/world';
import { Biome, classify, latitudeHumidity, temperatureC } from '@/climate/biome';
import { distanceToWater } from '@/climate/distanceToWater';

export interface ClimateInput {
  readonly size: RasterSize;
  readonly heightWorld: Float32Array;
  readonly waterLevel: Float32Array;
  readonly flowAcc: Float32Array;
  readonly seaLevelM: number;
  /** Seuil au-delà duquel un écoulement compte comme cours d'eau. */
  readonly riverThreshold: number;
  /** Override du MJ, déjà exprimé en référentiel monde. 0 = automatique. */
  readonly biomeOverride?: Uint8Array;
  /** Graine du bruit d'humidité, pour que le climat soit reproductible. */
  readonly seed?: string;
}

export interface ClimateBuffers {
  biome: Uint8Array;
  distance: Float32Array;
  isWater: Uint8Array;
}

export function createClimateBuffers(size: RasterSize): ClimateBuffers {
  const cells = size.width * size.height;
  return {
    biome: new Uint8Array(cells),
    distance: new Float32Array(cells),
    isWater: new Uint8Array(cells),
  };
}

/**
 * Distance, en cellules, au-delà de laquelle l'éloignement de l'eau ne sèche
 * plus davantage. Exprimée en fraction de la largeur pour rester stable quand
 * la résolution change.
 */
const CONTINENTAL_REACH_FRACTION = 0.06;

/**
 * Amplitude du bruit d'humidité.
 *
 * Sans lui, les ceintures de pluie dessinent des bandes horizontales franches
 * d'un bout à l'autre du monde : un climat de manuel, pas un climat de carte.
 */
const HUMIDITY_NOISE = 0.28;

const HUMIDITY_FBM = { octaves: 4, frequency: 2.2, lacunarity: 2, persistence: 0.5 };

export function computeBiomes(input: ClimateInput, buffers: ClimateBuffers): Uint8Array {
  const { size, heightWorld, waterLevel, flowAcc, seaLevelM, riverThreshold } = input;
  const { width, height } = size;
  const cells = width * height;
  const { biome, distance, isWater } = buffers;

  for (let i = 0; i < cells; i += 1) {
    isWater[i] = waterLevel[i]! > DRY && waterLevel[i]! > heightWorld[i]! ? 1 : 0;
  }
  distanceToWater(size, isWater, distance);

  const reach = Math.max(1, width * CONTINENTAL_REACH_FRACTION);
  const override = input.biomeOverride;
  const noise3D = createNoise3D(rngFor(input.seed ?? 'pangee', 'climate'));

  for (let y = 0; y < height; y += 1) {
    const lat = latOfRow(y, height);
    const humidityFromLatitude = latitudeHumidity(lat);
    const row = y * width;

    for (let x = 0; x < width; x += 1) {
      const index = row + x;

      const forced = override?.[index] ?? Biome.Auto;
      if (forced !== Biome.Auto) {
        biome[index] = forced;
        continue;
      }

      if (isWater[index] === 1) {
        biome[index] = Biome.Ocean;
        continue;
      }

      const altitude = heightWorld[index]! - seaLevelM;

      // L'éloignement de l'eau assèche, la proximité d'un cours d'eau humidifie.
      const oceanic = 1 - Math.min(1, distance[index]! / reach);
      const riverBonus = flowAcc[index]! > riverThreshold ? 0.25 : 0;
      const wobble =
        fbmCylinder(noise3D, lonOfColumn(x, width), lat, HUMIDITY_FBM) * HUMIDITY_NOISE;
      const humidity = Math.max(
        0,
        Math.min(1, humidityFromLatitude * (0.35 + 0.65 * oceanic) + riverBonus + wobble),
      );

      // Un fond plat, à peine au-dessus de l'eau et très arrosé : un marais.
      const marshy = altitude < 60 && flowAcc[index]! > riverThreshold * 4;

      biome[index] = classify(temperatureC(lat, altitude), humidity, altitude, marshy);
    }
  }

  return biome;
}

export * from '@/climate/biome';
export { distanceToWater } from '@/climate/distanceToWater';

/**
 * Formation du relief : masque continental, détail, redistribution.
 *
 * Écrit uniquement en référentiel local — le monde tel qu'avant le Cataclysme.
 * Le découpage en anneaux n'intervient jamais ici. Voir docs/generation.md.
 */

import { createNoise3D } from 'simplex-noise';
import { latOfRow, lonOfColumn } from '@/model/coords';
import { fbmCylinder, ridgedCylinder, smoothstep, type FbmParams, type Noise3D } from '@/gen/noise';
import { rngFor } from '@/gen/rng';
import type { RasterSize } from '@/model/world';

export interface TerrainParams {
  readonly seed: string;
  /** Nombre indicatif de continents, 2 à 8. Pilote la fréquence du masque. */
  readonly continentCount: number;
  /** Part de terres émergées, 0 à 1. Seuil du masque continental. */
  readonly continentSize: number;
  /** Découpe des côtes et des crêtes, 0 à 1. */
  readonly roughness: number;
}

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
  seed: 'pangee',
  continentCount: 4,
  continentSize: 0.5,
  roughness: 0.5,
};

export const MAX_ALTITUDE_M = 6000;
export const MAX_DEPTH_M = 8000;

/** Exposant terrestre > 1 : larges plaines côtières, sommets rares. */
const LAND_EXP = 2.2;
/** Exposant océanique plus faible : plateau continental court, grands fonds. */
const OCEAN_EXP = 1.4;

/** Poids du détail haute fréquence dans la somme. */
const DETAIL_WEIGHT = 0.3;

/**
 * Gain appliqué à l'élévation avant la courbe puissance.
 *
 * Un fBm normalisé reste très en deçà de ses bornes : sans gain, l'exposant
 * terrestre écrase tout et le monde n'a plus une seule cime au-dessus de
 * 1600 m. Mesuré sur la distribution des altitudes, pas supposé.
 */
const LAND_GAIN = 2.4;

/** Poids des crêtes, qui transforment les hauteurs en chaînes. */
const RIDGE_WEIGHT = 0.42;

/** En deçà de cette élévation, aucune crête : les plaines restent plates. */
const RIDGE_ONSET = 0.12;

/** Amplitude du domain warping, qui casse la rondeur des taches. */
const WARP_STRENGTH = 18;

/** Au-delà de cette latitude, le détail haute fréquence devient illisible. */
const POLAR_FADE_START = 70;
const POLAR_FADE_END = 88;

const CONTINENT_OCTAVES = 3;
const DETAIL_OCTAVES = 7;

function continentParams(continentCount: number): FbmParams {
  return {
    octaves: CONTINENT_OCTAVES,
    frequency: 0.35 + continentCount * 0.15,
    lacunarity: 2,
    persistence: 0.5,
  };
}

function detailParams(roughness: number): FbmParams {
  return {
    octaves: DETAIL_OCTAVES,
    frequency: 1.6,
    lacunarity: 2,
    persistence: 0.45 + 0.25 * roughness,
  };
}

/**
 * Génère le raster d'altitude en mètres.
 * Le tampon de sortie est fourni par l'appelant pour être réutilisé entre deux
 * générations et transféré sans copie.
 */
export function generateHeight(
  size: RasterSize,
  params: TerrainParams,
  out: Float32Array = new Float32Array(size.width * size.height),
): Float32Array {
  const rng = rngFor(params.seed, 'relief');
  const baseNoise: Noise3D = createNoise3D(rng);
  const warpNoise: Noise3D = createNoise3D(rng);
  const detailNoise: Noise3D = createNoise3D(rng);
  const ridgeNoise: Noise3D = createNoise3D(rng);

  const continent = continentParams(params.continentCount);
  const detail = detailParams(params.roughness);

  // continentSize élevé = plus de terres = seuil bas.
  const landThreshold = 0.35 - params.continentSize * 0.5;

  for (let y = 0; y < size.height; y += 1) {
    const lat = latOfRow(y, size.height);
    const absLat = Math.abs(lat);
    const polar = 1 - smoothstep(POLAR_FADE_START, POLAR_FADE_END, absLat);
    const row = y * size.width;

    for (let x = 0; x < size.width; x += 1) {
      const lon = lonOfColumn(x, size.width);

      // Domain warping : on déplace le point d'échantillonnage du masque avec
      // un bruit basse fréquence, ce qui donne des côtes moins circulaires.
      const warp = fbmCylinder(warpNoise, lon, lat, { ...continent, octaves: 2 });
      const lonW = lon + warp * WARP_STRENGTH;
      const latW = lat + warp * WARP_STRENGTH * 0.5;

      const mask = fbmCylinder(baseNoise, lonW, latW, continent);
      // Recentré sur le seuil : > 0 = terre, < 0 = mer.
      const continental = mask - landThreshold;

      const d = fbmCylinder(detailNoise, lon, lat, detail) * polar;

      // Le détail ne s'applique qu'aux terres et au plateau continental :
      // les grands fonds restent lisses.
      const detailMask = smoothstep(-0.25, 0.1, continental);
      let e = continental * 0.7 + d * DETAIL_WEIGHT * detailMask;

      // Les crêtes ne s'installent que sur les terres déjà hautes : elles
      // soulignent les reliefs au lieu de hérisser les plaines.
      if (e > RIDGE_ONSET) {
        const ridge = ridgedCylinder(ridgeNoise, lon, lat, detail) * polar;
        e += (ridge - 0.5) * RIDGE_WEIGHT * smoothstep(RIDGE_ONSET, 0.45, e);
      }

      e = Math.max(-1, Math.min(1, e * (e > 0 ? LAND_GAIN : 1)));

      // Les pôles sont tirés vers l'océan : on obtient des calottes plutôt que
      // des artefacts convergents.
      const epolar = e * polar - (1 - polar) * 0.15;

      out[row + x] = elevationToMeters(epolar);
    }
  }

  return out;
}

/**
 * Redistribution : une courbe puissance séparée pour les terres et pour les
 * fonds marins, appliquée à une élévation normalisée dans [-1, 1].
 */
export function elevationToMeters(e: number): number {
  return e >= 0 ? Math.pow(e, LAND_EXP) * MAX_ALTITUDE_M : -Math.pow(-e, OCEAN_EXP) * MAX_DEPTH_M;
}

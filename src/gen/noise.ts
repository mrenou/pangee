/**
 * Bruit fractal échantillonné sur le cylindre de Pangée.
 *
 * Un bruit 2D en (lon, lat) laisserait une couture visible au méridien ±180.
 * On échantillonne donc un bruit 3D sur un cercle : la longitude devient un
 * angle, le cylindre se referme, et la couture disparaît par construction.
 * Voir docs/generation.md.
 */

import { DEG_TO_RAD } from '@/model/coords';

export type Noise3D = (x: number, y: number, z: number) => number;

/** Étirement de l'axe latitudinal, pour que le bruit ne soit pas aplati. */
export const LAT_SCALE = 1.2;

export interface FbmParams {
  readonly octaves: number;
  readonly frequency: number;
  readonly lacunarity: number;
  readonly persistence: number;
}

/** Un échantillon de bruit à la fréquence donnée, continu au wrap. */
export function sampleCylinder(
  noise3D: Noise3D,
  lonDeg: number,
  latDeg: number,
  frequency: number,
): number {
  const theta = lonDeg * DEG_TO_RAD;
  return noise3D(
    Math.cos(theta) * frequency,
    Math.sin(theta) * frequency,
    (latDeg / 90) * frequency * LAT_SCALE,
  );
}

/**
 * Somme d'octaves de bruit cylindrique, normalisée dans [-1, 1].
 * Aucune allocation : appelée une fois par cellule sur deux millions de cellules.
 */
export function fbmCylinder(
  noise3D: Noise3D,
  lonDeg: number,
  latDeg: number,
  p: FbmParams,
): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = p.frequency;
  let norm = 0;

  for (let o = 0; o < p.octaves; o += 1) {
    sum += sampleCylinder(noise3D, lonDeg, latDeg, frequency) * amplitude;
    norm += amplitude;
    amplitude *= p.persistence;
    frequency *= p.lacunarity;
  }

  return norm === 0 ? 0 : sum / norm;
}

/** Interpolation de Hermite de la bibliothèque standard des shaders. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Bruit de crêtes : on replie le bruit sur lui-même, ce qui transforme ses
 * passages par zéro en arêtes vives. C'est ce qui fait des chaînes de montagnes
 * là où un fBm ordinaire ne donne que des bosses isolées.
 */
export function ridgedCylinder(
  noise3D: Noise3D,
  lonDeg: number,
  latDeg: number,
  p: FbmParams,
): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = p.frequency;
  let norm = 0;

  for (let o = 0; o < p.octaves; o += 1) {
    const folded = 1 - Math.abs(sampleCylinder(noise3D, lonDeg, latDeg, frequency));
    // Le carré resserre les arêtes et aplatit les vallées.
    sum += folded * folded * amplitude;
    norm += amplitude;
    amplitude *= p.persistence;
    frequency *= p.lacunarity;
  }

  return norm === 0 ? 0 : sum / norm;
}

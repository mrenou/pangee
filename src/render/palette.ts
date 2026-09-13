/**
 * Palette « carte de roman ».
 *
 * Peu de teintes, toutes tirées vers le parchemin et l'encre : une carte gravée
 * n'a pas la saturation d'une image satellite. Les couleurs sont exposées au
 * shader sous forme de table indexée par biome. Voir docs/rendu.md.
 */

import { BIOME_COUNT, Biome } from '@/climate';

export const PARCHMENT = 0xd4c4a0;
export const INK = 0x2b2118;

type Rgb = readonly [number, number, number];

const BIOME_COLORS: Readonly<Record<number, Rgb>> = {
  [Biome.Auto]: [0.82, 0.78, 0.65],
  [Biome.Ocean]: [0.6, 0.68, 0.7],
  [Biome.Ice]: [0.93, 0.93, 0.92],
  [Biome.Tundra]: [0.78, 0.77, 0.7],
  [Biome.Taiga]: [0.55, 0.6, 0.5],
  [Biome.Steppe]: [0.82, 0.78, 0.58],
  [Biome.TemperateForest]: [0.6, 0.66, 0.49],
  [Biome.TemperateRainforest]: [0.5, 0.6, 0.45],
  [Biome.Desert]: [0.88, 0.82, 0.63],
  [Biome.Savanna]: [0.82, 0.76, 0.53],
  [Biome.TropicalForest]: [0.56, 0.64, 0.44],
  [Biome.TropicalRainforest]: [0.47, 0.58, 0.41],
  [Biome.Alpine]: [0.72, 0.69, 0.65],
  [Biome.Marsh]: [0.62, 0.65, 0.53],
};

/** Table plate, prête pour un uniforme `vec3[]`. */
export function biomePaletteArray(): Float32Array {
  const out = new Float32Array(BIOME_COUNT * 3);
  for (let id = 0; id < BIOME_COUNT; id += 1) {
    const color = BIOME_COLORS[id] ?? BIOME_COLORS[Biome.Auto]!;
    out[id * 3] = color[0];
    out[id * 3 + 1] = color[1];
    out[id * 3 + 2] = color[2];
  }
  return out;
}

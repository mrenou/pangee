/**
 * Biomes dérivés du relief et de l'eau.
 *
 * Recalculés en référentiel monde à chaque date : quand un anneau emporte une
 * côte vers le pôle, son climat change. L'override du MJ reste prioritaire.
 * Voir docs/generation.md et docs/modele-monde.md.
 */

export const Biome = {
  /** Valeur réservée à `biomeOverride` : « laisser le climat décider ». */
  Auto: 0,
  Ocean: 1,
  Ice: 2,
  Tundra: 3,
  Taiga: 4,
  Steppe: 5,
  TemperateForest: 6,
  TemperateRainforest: 7,
  Desert: 8,
  Savanna: 9,
  TropicalForest: 10,
  TropicalRainforest: 11,
  Alpine: 12,
  Marsh: 13,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

export const BIOME_COUNT = 14;

/** Refroidissement avec l'altitude, en degrés par mètre. */
export const LAPSE_RATE_C_PER_M = 0.0065;

/** Température de surface au niveau de la mer, à cette latitude. */
export function baseTemperatureC(latDeg: number): number {
  const t = Math.abs(latDeg) / 90;
  return 30 - 58 * Math.pow(t, 1.35);
}

/** Température tenant compte de l'altitude au-dessus du niveau de la mer. */
export function temperatureC(latDeg: number, altitudeM: number): number {
  return baseTemperatureC(latDeg) - Math.max(0, altitudeM) * LAPSE_RATE_C_PER_M;
}

/**
 * Ceintures de pluie : humide à l'équateur, sec vers 25°, humide vers 55°,
 * sec aux pôles. C'est la circulation atmosphérique réelle, simplifiée à
 * l'essentiel — elle place les déserts là où le lecteur les attend.
 */
export function latitudeHumidity(latDeg: number): number {
  const a = Math.abs(latDeg);
  const equatorial = Math.exp(-((a / 14) ** 2));
  const temperate = 0.75 * Math.exp(-(((a - 55) / 18) ** 2));
  const polar = 0.25 * Math.exp(-(((a - 90) / 25) ** 2));
  return Math.min(1, equatorial + temperate + polar);
}

/**
 * Choisit un biome. `humidity` et la température sont déjà calculées ; cette
 * fonction ne fait que trancher, pour rester testable ligne à ligne.
 */
export function classify(
  temperatureC: number,
  humidity: number,
  altitudeAboveSeaM: number,
  isWet: boolean,
): BiomeId {
  if (isWet) return Biome.Marsh;
  if (temperatureC < -12) return Biome.Ice;

  // Au-dessus de la limite des arbres, le climat compte moins que la roche.
  if (altitudeAboveSeaM > 2600 && temperatureC < 4) return Biome.Alpine;

  if (temperatureC < -2) return Biome.Tundra;

  if (temperatureC < 7) return humidity > 0.35 ? Biome.Taiga : Biome.Tundra;

  if (temperatureC < 20) {
    if (humidity < 0.22) return Biome.Steppe;
    if (humidity < 0.62) return Biome.TemperateForest;
    return Biome.TemperateRainforest;
  }

  if (humidity < 0.18) return Biome.Desert;
  if (humidity < 0.42) return Biome.Savanna;
  if (humidity < 0.7) return Biome.TropicalForest;
  return Biome.TropicalRainforest;
}

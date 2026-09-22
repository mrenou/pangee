/**
 * Placement des lieux habités.
 *
 * On note chaque cellule sur des critères de survie — eau douce, altitude
 * raisonnable, biome vivable, pente faible — puis on retient les meilleures en
 * imposant une distance minimale entre lieux. Voir docs/generation.md.
 */

import { Biome } from '@/climate';
import { DRY } from '@/hydro/types';
import { nameForPlace } from '@/gen/names';
import { hashSeed, mulberry32 } from '@/gen/rng';
import { latOfRow, lonOfColumn, kmPerDegLat, kmPerDegLon, wrapLon } from '@/model/coords';
import { ringOf, type RingConfig } from '@/model/ring';
import type { Place, PlaceKind, PlaceSize, RasterSize } from '@/model/world';

export interface PlacementInput {
  readonly size: RasterSize;
  readonly heightWorld: Float32Array;
  readonly waterLevel: Float32Array;
  readonly flowAcc: Float32Array;
  readonly biome: Uint8Array;
  readonly seaLevelM: number;
  readonly riverThreshold: number;
  readonly radiusKm: number;
  readonly ringConfig: RingConfig;
  readonly seed: string;
  /** 0 à 1 : environ cinquante lieux à 0, cent cinquante à 1. */
  readonly placeDensity: number;
}

/** Altitude au-delà de laquelle un site remarquable peut être un volcan. */
const VOLCANO_MIN_M = 1400;

/** Altitude maximale d'un établissement permanent. */
const MAX_SETTLEMENT_M = 2200;

/** Un village a besoin d'être un peu au-dessus de l'eau. */
const MIN_SETTLEMENT_M = 5;

/** Une cellule sur COARSE est examinée : de quoi placer cent cinquante lieux. */
const COARSE = 3;

const UNLIVABLE = new Set<number>([Biome.Ocean, Biome.Ice, Biome.Alpine]);

/** Biomes où l'on s'installe volontiers, et ceux que l'on subit. */
const BIOME_SCORE: Readonly<Record<number, number>> = {
  [Biome.TemperateForest]: 1,
  [Biome.TemperateRainforest]: 0.85,
  [Biome.Steppe]: 0.8,
  [Biome.Savanna]: 0.7,
  [Biome.TropicalForest]: 0.7,
  [Biome.TropicalRainforest]: 0.5,
  [Biome.Taiga]: 0.45,
  [Biome.Marsh]: 0.35,
  [Biome.Tundra]: 0.2,
  [Biome.Desert]: 0.15,
};

export function targetPlaceCount(placeDensity: number): number {
  return Math.round(50 + Math.max(0, Math.min(1, placeDensity)) * 100);
}

/** La distance minimale se resserre quand on demande plus de lieux. */
export function minDistanceKm(placeDensity: number): number {
  return 450 - Math.max(0, Math.min(1, placeDensity)) * 270;
}

/** Distance sur le cylindre, en kilomètres, wrap en longitude compris. */
export function distanceKm(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
  radiusKm: number,
): number {
  const midLat = (latA + latB) / 2;
  const dx = wrapLon(lonB - lonA) * kmPerDegLon(midLat, radiusKm);
  const dy = (latB - latA) * kmPerDegLat(radiusKm);
  return Math.hypot(dx, dy);
}

interface Candidate {
  readonly index: number;
  readonly score: number;
}

export function placePlaces(input: PlacementInput): readonly Place[] {
  const {
    size,
    heightWorld,
    waterLevel,
    flowAcc,
    biome,
    seaLevelM,
    riverThreshold,
    radiusKm,
    ringConfig,
    seed,
    placeDensity,
  } = input;
  const { width, height } = size;

  const candidates: Candidate[] = [];
  const jitter = mulberry32(hashSeed(seed, 'places'));

  for (let y = 1; y < height - 1; y += COARSE) {
    for (let x = 0; x < width; x += COARSE) {
      const index = y * width + x;

      if (waterLevel[index]! > heightWorld[index]!) continue;

      const altitude = heightWorld[index]! - seaLevelM;
      if (altitude < MIN_SETTLEMENT_M || altitude > MAX_SETTLEMENT_M) continue;

      const b = biome[index]!;
      if (UNLIVABLE.has(b)) continue;
      const biomeScore = BIOME_SCORE[b] ?? 0.3;

      // Eau douce et rivage : un lieu vit de ce qu'il touche.
      const water = waterScore(size, index, waterLevel, heightWorld, flowAcc, riverThreshold);
      if (water <= 0) continue;

      // Une pente forte interdit de bâtir.
      const slope = localSlope(size, index, heightWorld);
      const flatness = 1 / (1 + slope / 120);

      // Le bruit évite un semis trop mécanique là où les scores se valent.
      const score = biomeScore * water * flatness * (0.8 + jitter() * 0.4);
      candidates.push({ index, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const wanted = targetPlaceCount(placeDensity);
  const minKm = minDistanceKm(placeDensity);
  const places: Place[] = [];

  for (const candidate of candidates) {
    if (places.length >= wanted) break;

    const x = candidate.index % width;
    const y = (candidate.index - x) / width;
    const lon = lonOfColumn(x, width);
    const lat = latOfRow(y, height);

    let tooClose = false;
    for (const placed of places) {
      if (distanceKm(lon, lat, placed.lon, placed.lat, radiusKm) < minKm) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const rank = places.length / wanted;
    const ringId = ringOf(lat, ringConfig);
    const id = `place-${places.length}`;

    places.push({
      id,
      ringId,
      lon,
      lat,
      name: nameForPlace(ringId, hashSeed(`${seed}:${id}`, 'names')),
      kind: kindFor(
        rank,
        mulberry32(hashSeed(id, 'places'))(),
        heightWorld[candidate.index]! - seaLevelM,
      ),
      size: sizeFor(rank),
    });
  }

  return places;
}

/**
 * Proximité de l'eau : une côte, un bord de lac ou un cours d'eau à portée.
 * Zéro si le lieu n'a accès à aucun des trois — on n'y fonde rien.
 */
function waterScore(
  size: RasterSize,
  index: number,
  waterLevel: Float32Array,
  heightWorld: Float32Array,
  flowAcc: Float32Array,
  riverThreshold: number,
): number {
  const { width, height } = size;
  const x = index % width;
  const y = (index - x) / width;

  let best = 0;
  const radius = 2;

  for (let dy = -radius; dy <= radius; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      let nx = x + dx;
      if (nx < 0) nx += width;
      else if (nx >= width) nx -= width;
      const neighbour = ny * width + nx;

      const near = 1 - (Math.abs(dx) + Math.abs(dy)) / (2 * radius + 2);

      if (waterLevel[neighbour]! > DRY && waterLevel[neighbour]! > heightWorld[neighbour]!) {
        // Un rivage : le meilleur emplacement qui soit.
        best = Math.max(best, near);
      } else if (flowAcc[neighbour]! > riverThreshold) {
        // Un cours d'eau : presque aussi bien, et souvent mieux abrité.
        best = Math.max(best, near * 0.95);
      }
    }
  }

  return best;
}

/** Dénivelé maximal entre la cellule et ses voisines immédiates, en mètres. */
function localSlope(size: RasterSize, index: number, heightWorld: Float32Array): number {
  const { width, height } = size;
  const x = index % width;
  const y = (index - x) / width;
  const here = heightWorld[index]!;

  let maxDrop = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      let nx = x + dx;
      if (nx < 0) nx += width;
      else if (nx >= width) nx -= width;
      maxDrop = Math.max(maxDrop, Math.abs(here - heightWorld[ny * width + nx]!));
    }
  }
  return maxDrop;
}

/** Les premiers placés sont les mieux dotés : ce sont les grandes villes. */
export function sizeFor(rank: number): PlaceSize {
  if (rank < 0.08) return 4;
  if (rank < 0.25) return 3;
  if (rank < 0.6) return 2;
  return 1;
}

export function kindFor(rank: number, roll: number, altitudeM: number): PlaceKind {
  // En altitude, une part des sites remarquables sont des volcans.
  if (altitudeM > VOLCANO_MIN_M && roll > 0.78) return 'volcano';

  // Une part fixe du monde n'est pas habitée : des ruines et des repères.
  if (roll > 0.93) return 'ruin';
  if (roll > 0.88) return 'fortress';
  if (roll > 0.85) return 'landmark';

  if (rank < 0.08) return 'city';
  if (rank < 0.3) return 'town';
  return 'village';
}

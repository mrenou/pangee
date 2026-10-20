/**
 * Le monde persisté, en référentiel local : couches raster et objets vectoriels.
 * Voir docs/modele-monde.md et docs/fichier-pangee.md.
 */

import type { RingConfig, RingId } from '@/model/ring';

export type PlaceKind = 'city' | 'town' | 'village' | 'ruin' | 'fortress' | 'volcano' | 'landmark';

export type PlaceSize = 1 | 2 | 3 | 4;

export interface Place {
  readonly id: string;
  readonly ringId: RingId;
  /** Longitude en référentiel local. */
  readonly lon: number;
  readonly lat: number;
  readonly name: string;
  readonly kind: PlaceKind;
  readonly size: PlaceSize;
  readonly notes?: string;
}

export type RoadKind = 'road' | 'path' | 'sea-route';

export interface Road {
  readonly id: string;
  readonly ringId: RingId;
  /** Points [lonLocal, lat]. Une route ne franchit jamais une coupure. */
  readonly points: readonly (readonly [number, number])[];
  readonly kind: RoadKind;
}

export type CreatureKind = 'dragon' | 'ship' | 'bird' | 'serpent';

export const CREATURE_KINDS = [
  'dragon',
  'ship',
  'bird',
  'serpent',
] as const satisfies readonly CreatureKind[];

/**
 * Créature décorative qui parcourt une trajectoire. Ses points sont en
 * référentiel local de son anneau : la trajectoire tourne avec lui. Elle ne
 * dépend pas de la date de campagne mais de l'horloge d'animation — c'est un
 * ornement, pas un fait du monde.
 */
export interface Creature {
  readonly id: string;
  readonly name: string;
  readonly kind: CreatureKind;
  readonly ringId: RingId;
  /** Points [lonLocal, lat] de la trajectoire, au moins deux. */
  readonly points: readonly (readonly [number, number])[];
  /** Vitesse le long de la trajectoire, en degrés par seconde d'animation. */
  readonly speedDegPerS: number;
  /** Boucle fermée, ou aller-retour entre le premier et le dernier point. */
  readonly loop: boolean;
}

export interface RasterSize {
  readonly width: number;
  readonly height: number;
}

export const RASTER_2K: RasterSize = { width: 2048, height: 1024 };
export const RASTER_4K: RasterSize = { width: 4096, height: 2048 };

/** Facteur de réduction du brouillard par rapport au relief. */
export const FOG_DOWNSCALE = 8;

/** Taille du raster de brouillard pour un relief donné. */
export function fogSizeOf(size: RasterSize): RasterSize {
  return {
    width: Math.ceil(size.width / FOG_DOWNSCALE),
    height: Math.ceil(size.height / FOG_DOWNSCALE),
  };
}

/** Couches raster, toutes en référentiel local et couvrant la planète entière. */
export interface WorldLayers {
  readonly size: RasterSize;
  /** Altitude en mètres ; négatif = sous le niveau de la mer. */
  readonly height: Float32Array;
  /** 0 = biome automatique, sinon biome forcé par le MJ. */
  readonly biomeOverride: Uint8Array;
  /** Brouillard de guerre, basse résolution : 0 = inconnu, 255 = révélé. */
  readonly fog: Uint8Array;
}

export interface WorldSettings {
  readonly radiusKm: number;
  readonly seaLevelM: number;
  /** Date de campagne, en jours depuis le Cataclysme. */
  readonly tDays: number;
}

export const DEFAULT_SETTINGS: WorldSettings = {
  radiusKm: 6371,
  seaLevelM: 0,
  tDays: 0,
};

export interface World {
  readonly ringConfig: RingConfig;
  readonly settings: WorldSettings;
  readonly layers: WorldLayers;
  readonly places: readonly Place[];
  readonly roads: readonly Road[];
  readonly creatures: readonly Creature[];
  readonly seed: string;
}

/** Alloue des couches vides à la taille demandée. */
export function createEmptyLayers(size: RasterSize): WorldLayers {
  const cells = size.width * size.height;
  const fogSize = fogSizeOf(size);
  const fogCells = fogSize.width * fogSize.height;
  return {
    size,
    height: new Float32Array(cells),
    biomeOverride: new Uint8Array(cells),
    fog: new Uint8Array(fogCells),
  };
}

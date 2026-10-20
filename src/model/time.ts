/**
 * Le temps de Pangée : la date de campagne pilote la position des anneaux.
 *
 * L'état du monde est une fonction pure de la date. Rien n'est accumulé, donc
 * sauter d'une date à l'autre et revenir redonne exactement le même monde.
 * Voir docs/temps.md.
 */

import { clampLat, DEG_TO_RAD, wrapLon } from '@/model/coords';
import {
  ringBounds,
  ringById,
  ringIndexOf,
  type Ring,
  type RingConfig,
  type RingId,
} from '@/model/ring';

/** Décalage en longitude de l'anneau à la date donnée : Δλ_r(t). */
export function ringOffsetDeg(ring: Ring, tDays: number, t0: number): number {
  return wrapLon(ring.omegaDegPerDay * (tDays - t0));
}

/** Décalage de chaque anneau à la date donnée, dans l'ordre des anneaux. */
export function ringOffsetsDeg(cfg: RingConfig, tDays: number): readonly number[] {
  return cfg.rings.map((ring) => ringOffsetDeg(ring, tDays, cfg.t0));
}

/** Décalage de l'anneau auquel appartient une latitude. */
export function offsetAtLat(latDeg: number, cfg: RingConfig, tDays: number): number {
  return ringOffsetDeg(cfg.rings[ringIndexOf(latDeg, cfg)]!, tDays, cfg.t0);
}

/**
 * Décalage d'un anneau désigné par son identifiant — celui que portent une
 * route ou une créature. `fallbackLat` sert si l'identifiant est inconnu.
 */
export function offsetOfRing(
  id: RingId,
  fallbackLat: number,
  cfg: RingConfig,
  tDays: number,
): number {
  return ringOffsetDeg(ringById(cfg, id, fallbackLat), tDays, cfg.t0);
}

/** Référentiel local vers référentiel monde, à la date donnée. */
export function localToWorldLon(
  lonLocal: number,
  latDeg: number,
  cfg: RingConfig,
  tDays: number,
): number {
  return wrapLon(lonLocal + offsetAtLat(latDeg, cfg, tDays));
}

/** Référentiel monde vers référentiel local : l'inverse exact du précédent. */
export function worldToLocalLon(
  lonWorld: number,
  latDeg: number,
  cfg: RingConfig,
  tDays: number,
): number {
  return wrapLon(lonWorld - offsetAtLat(latDeg, cfg, tDays));
}

/** Latitude médiane d'un anneau, où l'on exprime sa vitesse en km/jour. */
export function midLat(index: number, cfg: RingConfig): number {
  const { north, south } = ringBounds(cfg, index);
  return (north + south) / 2;
}

/** Vitesse en kilomètres par jour d'un anneau à une latitude donnée. */
export function kmPerDay(omegaDegPerDay: number, latDeg: number, radiusKm: number): number {
  return omegaDegPerDay * DEG_TO_RAD * radiusKm * Math.cos(clampLat(latDeg) * DEG_TO_RAD);
}

/** Conversion inverse, pour saisir une vitesse en km/jour dans l'interface. */
export function omegaFromKmPerDay(km: number, latDeg: number, radiusKm: number): number {
  const denom = DEG_TO_RAD * radiusKm * Math.cos(clampLat(latDeg) * DEG_TO_RAD);
  return denom === 0 ? 0 : km / denom;
}

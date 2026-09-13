/**
 * Le temps de Pangée : la date de campagne pilote la position des anneaux.
 *
 * L'état du monde est une fonction pure de la date. Rien n'est accumulé, donc
 * sauter d'une date à l'autre et revenir redonne exactement le même monde.
 * Voir docs/temps.md.
 */

import { clampLat, DEG_TO_RAD, wrapLon } from '@/model/coords';
import { ringOf, type RingConfig, type Ring, type RingId } from '@/model/ring';

/** Décalage en longitude de l'anneau à la date donnée : Δλ_r(t). */
export function ringOffsetDeg(ring: Ring, tDays: number, t0: number): number {
  return wrapLon(ring.omegaDegPerDay * (tDays - t0));
}

/** Décalage de chacun des trois anneaux à la date donnée. */
export function ringOffsetsDeg(cfg: RingConfig, tDays: number): Readonly<Record<RingId, number>> {
  return {
    north: ringOffsetDeg(cfg.rings.north, tDays, cfg.t0),
    equator: ringOffsetDeg(cfg.rings.equator, tDays, cfg.t0),
    south: ringOffsetDeg(cfg.rings.south, tDays, cfg.t0),
  };
}

/** Référentiel local vers référentiel monde, à la date donnée. */
export function localToWorldLon(
  lonLocal: number,
  latDeg: number,
  cfg: RingConfig,
  tDays: number,
): number {
  const ring = cfg.rings[ringOf(latDeg, cfg)];
  return wrapLon(lonLocal + ringOffsetDeg(ring, tDays, cfg.t0));
}

/** Référentiel monde vers référentiel local : l'inverse exact du précédent. */
export function worldToLocalLon(
  lonWorld: number,
  latDeg: number,
  cfg: RingConfig,
  tDays: number,
): number {
  const ring = cfg.rings[ringOf(latDeg, cfg)];
  return wrapLon(lonWorld - ringOffsetDeg(ring, tDays, cfg.t0));
}

/** Latitude médiane d'un anneau, où l'on exprime sa vitesse en km/jour. */
export function midLat(ring: RingId, cfg: RingConfig): number {
  switch (ring) {
    case 'north':
      return (cfg.cutNorthLat + 90) / 2;
    case 'equator':
      return (cfg.cutNorthLat + cfg.cutSouthLat) / 2;
    case 'south':
      return (cfg.cutSouthLat - 90) / 2;
  }
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

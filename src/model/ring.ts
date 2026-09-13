/**
 * Les trois anneaux de Pangée et leurs coupures.
 *
 * Les frontières sont nettes : une latitude appartient à un anneau et à un
 * seul, sans transition. Voir docs/modele-monde.md.
 */

export type RingId = 'north' | 'equator' | 'south';

export const RING_IDS = ['north', 'equator', 'south'] as const satisfies readonly RingId[];

export interface Ring {
  readonly id: RingId;
  /** Vitesse angulaire signée : positif vers l'est, 0 = anneau immobile. */
  readonly omegaDegPerDay: number;
}

export interface RingConfig {
  /** Frontière nord/équateur. Invariant : cutSouthLat < cutNorthLat. */
  readonly cutNorthLat: number;
  /** Frontière équateur/sud. */
  readonly cutSouthLat: number;
  readonly rings: Readonly<Record<RingId, Ring>>;
  /** Date à laquelle les anneaux sont alignés. 0 = instant du Cataclysme. */
  readonly t0: number;
}

export const DEFAULT_RING_CONFIG: RingConfig = {
  cutNorthLat: 30,
  cutSouthLat: -30,
  rings: {
    north: { id: 'north', omegaDegPerDay: 0.05 },
    equator: { id: 'equator', omegaDegPerDay: 0 },
    south: { id: 'south', omegaDegPerDay: -0.03 },
  },
  t0: 0,
};

/** Anneau auquel appartient une latitude. */
export function ringOf(latDeg: number, cfg: RingConfig): RingId {
  if (latDeg > cfg.cutNorthLat) return 'north';
  if (latDeg < cfg.cutSouthLat) return 'south';
  return 'equator';
}

export type RingConfigError =
  'cuts-out-of-order' | 'cut-out-of-range' | 'omega-not-finite' | 't0-not-finite';

/**
 * Vérifie les invariants d'une configuration d'anneaux.
 * Renvoie la liste des violations, vide si la configuration est valide.
 */
export function validateRingConfig(cfg: RingConfig): readonly RingConfigError[] {
  const errors: RingConfigError[] = [];

  if (!(cfg.cutSouthLat < cfg.cutNorthLat)) errors.push('cuts-out-of-order');

  const inRange = (lat: number): boolean => lat > -90 && lat < 90;
  if (!inRange(cfg.cutNorthLat) || !inRange(cfg.cutSouthLat)) errors.push('cut-out-of-range');

  if (RING_IDS.some((id) => !Number.isFinite(cfg.rings[id].omegaDegPerDay))) {
    errors.push('omega-not-finite');
  }
  if (!Number.isFinite(cfg.t0)) errors.push('t0-not-finite');

  return errors;
}

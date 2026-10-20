/**
 * Les anneaux de Pangée et leurs coupures.
 *
 * Les anneaux sont rangés du nord au sud ; deux anneaux voisins sont séparés
 * par une latitude de coupure. Les frontières sont nettes : une latitude
 * appartient à un anneau et à un seul, sans transition. Voir
 * docs/modele-monde.md.
 */

/**
 * Identifiant stable d'un anneau. Lieux, routes et créatures le portent : il
 * survit aux scissions et aux déplacements de coupures. Les trois anneaux
 * d'origine s'appellent `north`, `equator` et `south`.
 */
export type RingId = string;

/** Plafond du nombre d'anneaux : le shader reçoit des tableaux de cette taille. */
export const MAX_RINGS = 8;

/** Écart minimal entre deux coupures, ou entre une coupure et un pôle, en degrés. */
export const MIN_RING_SPAN_DEG = 1;

export interface Ring {
  readonly id: RingId;
  readonly name: string;
  /** Vitesse angulaire signée : positif vers l'est, 0 = anneau immobile. */
  readonly omegaDegPerDay: number;
}

export interface RingConfig {
  /** Du nord au sud, au moins un. */
  readonly rings: readonly Ring[];
  /**
   * Latitudes de coupure, strictement décroissantes : `cutsLat[i]` sépare
   * `rings[i]`, au nord, de `rings[i + 1]`. Il y en a une de moins que
   * d'anneaux.
   */
  readonly cutsLat: readonly number[];
  /** Date à laquelle les anneaux sont alignés. 0 = instant du Cataclysme. */
  readonly t0: number;
}

export const DEFAULT_RING_CONFIG: RingConfig = {
  rings: [
    { id: 'north', name: 'Anneau nord', omegaDegPerDay: 0.05 },
    { id: 'equator', name: 'Anneau équatorial', omegaDegPerDay: 0 },
    { id: 'south', name: 'Anneau sud', omegaDegPerDay: -0.03 },
  ],
  cutsLat: [30, -30],
  t0: 0,
};

/**
 * Rang, du nord au sud, de l'anneau auquel appartient une latitude. Une
 * latitude de coupure appartient à l'anneau du sud.
 */
export function ringIndexOf(latDeg: number, cfg: RingConfig): number {
  let index = 0;
  for (const cut of cfg.cutsLat) if (latDeg <= cut) index += 1;
  return index;
}

/** Anneau auquel appartient une latitude. */
export function ringOf(latDeg: number, cfg: RingConfig): RingId {
  return cfg.rings[ringIndexOf(latDeg, cfg)]!.id;
}

/**
 * Anneau d'un identifiant. Un identifiant inconnu — une donnée abîmée — se
 * replie sur l'anneau de la latitude donnée plutôt que de faire échouer le
 * rendu.
 */
export function ringById(cfg: RingConfig, id: RingId, fallbackLat: number): Ring {
  return cfg.rings.find((ring) => ring.id === id) ?? cfg.rings[ringIndexOf(fallbackLat, cfg)]!;
}

/** Bornes nord et sud d'un anneau, en degrés de latitude. */
export function ringBounds(cfg: RingConfig, index: number): { north: number; south: number } {
  return {
    north: index === 0 ? 90 : cfg.cutsLat[index - 1]!,
    south: index === cfg.rings.length - 1 ? -90 : cfg.cutsLat[index]!,
  };
}

export type RingConfigError =
  | 'no-ring'
  | 'too-many-rings'
  | 'cut-count'
  | 'cuts-out-of-order'
  | 'cut-out-of-range'
  | 'duplicate-id'
  | 'omega-not-finite'
  | 't0-not-finite';

/**
 * Vérifie les invariants d'une configuration d'anneaux.
 * Renvoie la liste des violations, vide si la configuration est valide.
 */
export function validateRingConfig(cfg: RingConfig): readonly RingConfigError[] {
  const errors: RingConfigError[] = [];
  // Une configuration relue d'un fichier peut être mal formée : on ne fait
  // confiance qu'à de vrais tableaux.
  const rings: readonly Ring[] = Array.isArray(cfg.rings) ? cfg.rings : [];
  const cutsLat: readonly number[] = Array.isArray(cfg.cutsLat) ? cfg.cutsLat : [];

  if (rings.length === 0) return ['no-ring'];
  if (rings.length > MAX_RINGS) errors.push('too-many-rings');
  if (cutsLat.length !== rings.length - 1) {
    errors.push('cut-count');
    return errors;
  }

  for (let i = 1; i < cutsLat.length; i += 1) {
    if (!(cutsLat[i]! < cutsLat[i - 1]!)) errors.push('cuts-out-of-order');
  }
  if (cutsLat.some((lat) => !(lat > -90 && lat < 90))) errors.push('cut-out-of-range');
  if (new Set(rings.map((ring) => ring.id)).size !== rings.length) errors.push('duplicate-id');
  if (rings.some((ring) => !Number.isFinite(ring.omegaDegPerDay))) errors.push('omega-not-finite');
  if (!Number.isFinite(cfg.t0)) errors.push('t0-not-finite');

  return [...new Set(errors)];
}

/** Identifiant neuf, distinct de ceux de la configuration. */
function freshRingId(cfg: RingConfig): RingId {
  let n = cfg.rings.length + 1;
  while (cfg.rings.some((ring) => ring.id === `ring-${n}`)) n += 1;
  return `ring-${n}`;
}

/**
 * Coupe un anneau en deux à une latitude donnée. La moitié sud reçoit un
 * nouvel identifiant et **hérite de la vitesse** : à la date courante, rien ne
 * bouge, et le MJ règle ensuite la nouvelle vitesse. `undefined` si la
 * latitude tombe hors de l'anneau ou trop près de ses bords, ou si le plafond
 * d'anneaux est atteint.
 */
export function splitRing(cfg: RingConfig, index: number, latDeg: number): RingConfig | undefined {
  const ring = cfg.rings[index];
  if (!ring || cfg.rings.length >= MAX_RINGS) return undefined;
  const { north, south } = ringBounds(cfg, index);
  if (!(latDeg < north - MIN_RING_SPAN_DEG && latDeg > south + MIN_RING_SPAN_DEG)) return undefined;

  const id = freshRingId(cfg);
  const half: Ring = {
    id,
    name: `Anneau ${cfg.rings.length + 1}`,
    omegaDegPerDay: ring.omegaDegPerDay,
  };
  return {
    ...cfg,
    rings: [...cfg.rings.slice(0, index + 1), half, ...cfg.rings.slice(index + 1)],
    cutsLat: [...cfg.cutsLat.slice(0, index), latDeg, ...cfg.cutsLat.slice(index)],
  };
}

/**
 * Supprime la coupure `cutIndex` : les deux anneaux qu'elle séparait n'en font
 * plus qu'un, qui garde l'identité et la vitesse de celui du nord.
 */
export function removeCut(cfg: RingConfig, cutIndex: number): RingConfig | undefined {
  if (cutIndex < 0 || cutIndex >= cfg.cutsLat.length) return undefined;
  return {
    ...cfg,
    rings: cfg.rings.filter((_, i) => i !== cutIndex + 1),
    cutsLat: cfg.cutsLat.filter((_, i) => i !== cutIndex),
  };
}

/**
 * Déplace une coupure, bornée entre ses voisines : l'ordre des coupures est
 * maintenu par construction, une coupure pousse contre l'autre sans l'enjamber.
 */
export function moveCut(cfg: RingConfig, cutIndex: number, latDeg: number): RingConfig {
  if (cutIndex < 0 || cutIndex >= cfg.cutsLat.length) return cfg;
  const upper = (cutIndex === 0 ? 90 : cfg.cutsLat[cutIndex - 1]!) - MIN_RING_SPAN_DEG;
  const lower =
    (cutIndex === cfg.cutsLat.length - 1 ? -90 : cfg.cutsLat[cutIndex + 1]!) + MIN_RING_SPAN_DEG;
  const clamped = Math.min(upper, Math.max(lower, latDeg));
  return { ...cfg, cutsLat: cfg.cutsLat.map((lat, i) => (i === cutIndex ? clamped : lat)) };
}

/** Remplace un anneau par une version retouchée. */
export function updateRing(
  cfg: RingConfig,
  id: RingId,
  patch: Partial<Pick<Ring, 'name' | 'omegaDegPerDay'>>,
): RingConfig {
  return {
    ...cfg,
    rings: cfg.rings.map((ring) => (ring.id === id ? { ...ring, ...patch } : ring)),
  };
}

/** Les trois anneaux d'origine, aux vitesses données, dans l'ordre nord, équateur, sud. */
export function threeRings(speeds: {
  readonly north: number;
  readonly equator: number;
  readonly south: number;
}): readonly Ring[] {
  return DEFAULT_RING_CONFIG.rings.map((ring) => ({
    ...ring,
    omegaDegPerDay: speeds[ring.id as 'north' | 'equator' | 'south'],
  }));
}

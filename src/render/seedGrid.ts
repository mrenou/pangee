/**
 * Grille de semis des symboles.
 *
 * Les positions sont ancrées à une grille **fixe du monde**, jamais à une
 * grille dérivée du zoom : sinon chaque cran de molette redistribue toutes les
 * montagnes, et la carte semble se régénérer sous les yeux.
 *
 * Le niveau de détail se règle par un pas de parcours en puissance de deux. En
 * zoomant, le pas est divisé par deux : les points déjà affichés le restent —
 * un multiple de huit est un multiple de quatre — et de nouveaux s'intercalent.
 * Voir docs/rendu.md.
 */

/**
 * Pas de la grille la plus fine, en degrés.
 *
 * Il fixe la densité maximale atteignable, et doit rester sous l'espacement
 * visé au zoom le plus fort — sans quoi les symboles s'écartent au lieu de se
 * resserrer. Le coût du parcours n'en dépend pas : c'est le pas dyadique qui
 * s'ajuste, de sorte que le nombre de points visités reste proportionnel à la
 * surface de l'écran.
 */
export const FINE_STEP_DEG = 360 / 8192;

/** Le pas de parcours ne dépasse pas cette puissance de deux. */
const MAX_LEVEL = 12;

/**
 * Part de sa case qu'un point peut occuper en s'écartant du centre.
 *
 * En deçà, l'œil retrouve les rangées de la grille dans les forêts ; au-delà,
 * les symboles se chevauchent.
 */
export const SPREAD_FACTOR = 0.9;

/**
 * Pas de parcours, en nombre de cases fines, pour obtenir l'espacement visé.
 * Toujours une puissance de deux, pour que les points d'un pas large soient
 * inclus dans ceux d'un pas plus fin.
 */
export function strideFor(pixelsPerDegree: number, spacingPx: number): number {
  const wanted = spacingPx / (FINE_STEP_DEG * pixelsPerDegree);
  if (!Number.isFinite(wanted) || wanted <= 1) return 1;
  const level = Math.min(MAX_LEVEL, Math.floor(Math.log2(wanted)));
  return 1 << level;
}

/**
 * Rang d'apparition d'un point : le plus grand pas dyadique qui le contient.
 *
 * Un point d'indices divisibles par huit apparaît dès un pas de huit ; il sert
 * donc de sommet de montagne visible de loin, et son décalage aléatoire doit
 * rester à l'échelle de cet espacement-là, sans quoi il sauterait en zoomant.
 */
export function appearanceLevel(i: number, j: number): number {
  if (i === 0 && j === 0) return MAX_LEVEL;
  const zeros = (n: number): number => {
    if (n === 0) return MAX_LEVEL;
    const v = Math.abs(n);
    return Math.min(MAX_LEVEL, 31 - Math.clz32(v & -v));
  };
  return Math.min(zeros(i), zeros(j));
}

/** Amplitude du décalage d'un point, en degrés. */
export function spreadOf(i: number, j: number): number {
  return (1 << appearanceLevel(i, j)) * FINE_STEP_DEG * SPREAD_FACTOR;
}

/** Hash déterministe d'une case, stable d'un rendu à l'autre. */
export function hashCell(i: number, j: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

import { wrapLon } from '@/model/coords';
import { ringOf, type RingConfig } from '@/model/ring';
import { ringOffsetDeg } from '@/model/time';

export interface SeedPoint {
  readonly lon: number;
  readonly lat: number;
  /** Trois tirages stables, pour le type, la taille et la sélection. */
  readonly r1: number;
  readonly r2: number;
  readonly r3: number;
}

/**
 * Position d'un point de la grille, décalage compris.
 *
 * Elle ne dépend que des indices : le même point retombe au même endroit quel
 * que soit le zoom, ce qui est tout l'objet de ce module.
 */
export function seedPoint(i: number, j: number): SeedPoint {
  const r1 = hashCell(i, j);
  const r2 = hashCell(i + 9871, j - 1237);
  const r3 = hashCell(i - 421, j + 7717);

  // Le décalage suit l'espacement auquel le point apparaît : large pour un
  // sommet visible de loin, serré pour un détail qui ne sort qu'au zoom.
  // Il occupe presque toute la case : en deçà, l'œil retrouve les rangées de
  // la grille dans les forêts.
  const spread = spreadOf(i, j);

  return {
    lon: (i + 0.5) * FINE_STEP_DEG + (r1 - 0.5) * spread,
    lat: (j + 0.5) * FINE_STEP_DEG + (r2 - 0.5) * spread,
    r1,
    r2,
    r3,
  };
}

/**
 * Position affichée d'un point de semis, à une date donnée.
 *
 * La grille est en référentiel local : un symbole reste accroché à son morceau
 * de terrain et glisse avec son anneau. L'ancrer au référentiel monde laisserait
 * le relief défiler sous un semis immobile, et les montagnes changeraient de
 * forme sur place à mesure que le continent passe.
 * Voir docs/modele-monde.md.
 */
export function seedPointInWorld(i: number, j: number, cfg: RingConfig, tDays: number): SeedPoint {
  const point = seedPoint(i, j);
  const offset = ringOffsetDeg(cfg.rings[ringOf(point.lat, cfg)], tDays, cfg.t0);
  return { ...point, lon: wrapLon(point.lon + offset) };
}

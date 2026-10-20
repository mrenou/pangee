/**
 * Où se trouve une créature le long de sa trajectoire, à un instant donné.
 *
 * Calcul pur, sans Pixi : la trajectoire est en référentiel local de son
 * anneau, la distance parcourue vient de l'horloge d'animation. Voir
 * docs/rendu.md.
 */

import { deltaLon, wrapLon } from '@/model/coords';

export interface CreaturePose {
  readonly lonLocal: number;
  readonly lat: number;
  /** Cap, en degrés dans [−180, 180[ : 0 vers l'est, 90 vers le nord. */
  readonly headingDeg: number;
}

type Point = readonly [number, number];

/** Longueur de chaque segment, wrap en longitude compris, en degrés. */
function segmentLengths(points: readonly Point[], loop: boolean): number[] {
  const count = loop ? points.length : points.length - 1;
  const lengths: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    lengths.push(Math.hypot(deltaLon(a[0], b[0]), b[1] - a[1]));
  }
  return lengths;
}

/** Longueur totale d'une trajectoire, en degrés. */
export function pathLengthDeg(points: readonly Point[], loop: boolean): number {
  return segmentLengths(points, loop).reduce((sum, length) => sum + length, 0);
}

/**
 * Pose après `distanceDeg` degrés parcourus. Une boucle recommence au début ;
 * un aller-retour repart en sens inverse au dernier point.
 */
export function creaturePose(
  points: readonly Point[],
  loop: boolean,
  distanceDeg: number,
): CreaturePose {
  const first = points[0] ?? ([0, 0] as const);
  const lengths = segmentLengths(points, loop);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (points.length < 2 || total <= 0) return { lonLocal: first[0], lat: first[1], headingDeg: 0 };

  let along: number;
  let backwards = false;
  if (loop) {
    along = ((distanceDeg % total) + total) % total;
  } else {
    const lap = ((distanceDeg % (2 * total)) + 2 * total) % (2 * total);
    backwards = lap > total;
    along = backwards ? 2 * total - lap : lap;
  }

  let i = 0;
  while (i < lengths.length - 1 && along > lengths[i]!) {
    along -= lengths[i]!;
    i += 1;
  }

  const a = points[i]!;
  const b = points[(i + 1) % points.length]!;
  const t = lengths[i]! > 0 ? Math.min(1, along / lengths[i]!) : 0;
  const dLon = deltaLon(a[0], b[0]);
  const dLat = b[1] - a[1];
  const heading = (Math.atan2(dLat, dLon) * 180) / Math.PI;

  return {
    lonLocal: wrapLon(a[0] + dLon * t),
    lat: a[1] + dLat * t,
    headingDeg: backwards ? wrapLon(heading + 180) : heading,
  };
}

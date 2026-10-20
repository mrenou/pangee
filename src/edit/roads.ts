/**
 * Tracé et scission des routes.
 *
 * Une route appartient à un seul anneau. Celle qui franchit une coupure est
 * donc scindée dès sa création, de sorte qu'aucun consommateur n'ait à
 * connaître les frontières — et qu'à t ≠ t0 les deux moitiés divergent, ce qui
 * est précisément ce qu'on veut raconter. Voir docs/editeur.md.
 */

import { deltaLon, wrapLon } from '@/model/coords';
import { ringOf, type RingConfig, type RingId } from '@/model/ring';
import { ringOffsetDeg } from '@/model/time';
import type { Place, Road, RoadKind } from '@/model/world';

export type Point = readonly [number, number];

/** Les deux latitudes où une route peut être tranchée. */
function cutsOf(cfg: RingConfig): readonly number[] {
  return [cfg.cutNorthLat, cfg.cutSouthLat];
}

/**
 * Interpole un point du segment à la latitude donnée.
 * La longitude suit le plus court chemin, donc un segment qui franchit le
 * méridien ±180 est interpolé du bon côté.
 */
export function interpolateAtLat(a: Point, b: Point, lat: number): Point {
  const span = b[1] - a[1];
  if (span === 0) return [a[0], lat];
  const t = (lat - a[1]) / span;
  return [wrapLon(a[0] + deltaLon(a[0], b[0]) * t), lat];
}

/**
 * Insère un point à chaque franchissement de coupure.
 * Un long segment nord-sud peut en traverser deux : elles sont insérées dans
 * l'ordre du parcours.
 */
export function insertCutPoints(points: readonly Point[], cfg: RingConfig): readonly Point[] {
  if (points.length < 2) return points;

  const out: Point[] = [points[0]!];

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;

    const crossed = cutsOf(cfg)
      .filter((cut) => (a[1] < cut && b[1] > cut) || (a[1] > cut && b[1] < cut))
      .sort((c1, c2) => (b[1] > a[1] ? c1 - c2 : c2 - c1));

    for (const cut of crossed) out.push(interpolateAtLat(a, b, cut));
    out.push(b);
  }

  return out;
}

/** Anneau d'un segment, déterminé par son milieu — jamais par ses extrémités,
 * qui peuvent être posées exactement sur une coupure. */
function ringOfSegment(a: Point, b: Point, cfg: RingConfig): RingId {
  return ringOf((a[1] + b[1]) / 2, cfg);
}

let nextRoadId = 0;

/** Réinitialise le compteur d'identifiants. Réservé aux tests. */
export function resetRoadIds(): void {
  nextRoadId = 0;
}

/**
 * Transforme une polyligne tracée à la main en routes, une par anneau traversé.
 *
 * Le point de coupure appartient aux deux moitiés : elles se touchent donc
 * exactement à la frontière tant que les anneaux sont alignés.
 */
export function buildRoads(
  points: readonly Point[],
  cfg: RingConfig,
  kind: RoadKind = 'road',
  idPrefix = 'road',
): readonly Road[] {
  const dense = insertCutPoints(points, cfg);
  if (dense.length < 2) return [];

  const roads: Road[] = [];
  let current: Point[] = [dense[0]!];
  let currentRing = ringOfSegment(dense[0]!, dense[1]!, cfg);

  for (let i = 1; i < dense.length; i += 1) {
    const segmentRing = ringOfSegment(dense[i - 1]!, dense[i]!, cfg);

    if (segmentRing !== currentRing) {
      // Le point courant ferme la portion et ouvre la suivante.
      current.push(dense[i - 1]!);
      if (current.length >= 2) {
        roads.push(makeRoad(idPrefix, currentRing, current, kind));
      }
      current = [dense[i - 1]!];
      currentRing = segmentRing;
    }

    current.push(dense[i]!);
  }

  if (current.length >= 2) roads.push(makeRoad(idPrefix, currentRing, current, kind));

  return roads;
}

function makeRoad(prefix: string, ringId: RingId, points: readonly Point[], kind: RoadKind): Road {
  nextRoadId += 1;
  // Les doublons consécutifs viennent des points de coupure ajoutés des deux
  // côtés : ils n'apportent rien au tracé.
  const cleaned = points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1],
  );
  return { id: `${prefix}-${nextRoadId}`, ringId, points: cleaned, kind };
}

/**
 * Lieu le plus proche d'un point, dans la limite donnée.
 * Sert au magnétisme : un tracé qui part d'une ville doit en partir exactement.
 */
export function snapToPlace(
  lon: number,
  lat: number,
  places: readonly Place[],
  maxDeg: number,
): Place | undefined {
  let best: Place | undefined;
  let bestDistance = maxDeg;

  for (const place of places) {
    const d = Math.hypot(deltaLon(lon, place.lon), place.lat - lat);
    if (d <= bestDistance) {
      bestDistance = d;
      best = place;
    }
  }

  return best;
}

/**
 * Route la plus proche d'un point du référentiel monde, dans la limite donnée.
 *
 * Chaque route porte un seul anneau : un seul décalage suffit à la ramener là
 * où le MJ la voit. Les distances se mesurent en degrés, comme à l'écran, où
 * un degré de longitude et un degré de latitude font le même nombre de pixels.
 */
export function roadAtWorld(
  lonWorld: number,
  lat: number,
  roads: readonly Road[],
  cfg: RingConfig,
  tDays: number,
  maxDeg: number,
): Road | undefined {
  let best: Road | undefined;
  let bestDistance = maxDeg;

  for (const road of roads) {
    const offset = ringOffsetDeg(cfg.rings[road.ringId], tDays, cfg.t0);
    // Points exprimés relativement au curseur, couture du méridien comprise.
    let previous: Point | undefined;
    for (const [lon, pointLat] of road.points) {
      const point: Point = [deltaLon(lonWorld, lon + offset), pointLat - lat];
      if (previous) {
        const d = distanceToSegment(previous, point);
        if (d <= bestDistance) {
          bestDistance = d;
          best = road;
        }
      }
      previous = point;
    }
  }

  return best;
}

/** Distance de l'origine au segment [a, b]. */
export function distanceToSegment(a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSq));
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}

export function setRoadKind(roads: readonly Road[], id: string, kind: RoadKind): readonly Road[] {
  return roads.map((road) => (road.id === id ? { ...road, kind } : road));
}

export function removeRoad(roads: readonly Road[], id: string): readonly Road[] {
  return roads.filter((road) => road.id !== id);
}

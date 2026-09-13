/**
 * Caméra et conversions écran ↔ monde ↔ local.
 *
 * Une seule implémentation, partagée par le rendu et par les outils d'édition :
 * tout outil convertit en lonLocal avant d'écrire. Voir docs/rendu.md et
 * docs/editeur.md.
 */

import { clampLat, wrapLon } from '@/model/coords';
import type { RingConfig } from '@/model/ring';
import { worldToLocalLon } from '@/model/time';

export interface Viewport {
  /** Longitude monde au centre de l'écran. */
  readonly centerLonWorld: number;
  /** Latitude au centre de l'écran. */
  readonly centerLat: number;
  /** Zoom continu : pixels par degré de latitude. */
  readonly pixelsPerDegree: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Zoom au-delà duquel une cellule de raster dépasserait largement le pixel. */
export const MAX_PIXELS_PER_DEGREE = 400;

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface GeoPoint {
  readonly lon: number;
  readonly lat: number;
}

/** Zoom en deçà duquel la planète entière ne remplirait plus la hauteur. */
export function minPixelsPerDegree(heightPx: number): number {
  return heightPx / 180;
}

export function clampZoom(pixelsPerDegree: number, heightPx: number): number {
  const min = minPixelsPerDegree(heightPx);
  return Math.min(MAX_PIXELS_PER_DEGREE, Math.max(min, pixelsPerDegree));
}

/**
 * Borne la latitude du centre pour que les pôles ne rentrent pas dans l'écran.
 * Si la vue est plus haute que la planète, le centre est fixé à l'équateur.
 */
export function clampCenterLat(
  centerLat: number,
  heightPx: number,
  pixelsPerDegree: number,
): number {
  const halfHeightDeg = heightPx / 2 / pixelsPerDegree;
  const limit = 90 - halfHeightDeg;
  if (limit <= 0) return 0;
  return Math.min(limit, Math.max(-limit, centerLat));
}

/** Applique les deux bornes à un viewport, dans le bon ordre. */
export function normalizeViewport(v: Viewport): Viewport {
  const pixelsPerDegree = clampZoom(v.pixelsPerDegree, v.heightPx);
  return {
    ...v,
    pixelsPerDegree,
    centerLonWorld: wrapLon(v.centerLonWorld),
    centerLat: clampCenterLat(v.centerLat, v.heightPx, pixelsPerDegree),
  };
}

/** Point écran vers coordonnées monde. La longitude wrappe, la latitude clampe. */
export function screenToWorld(v: Viewport, p: ScreenPoint): GeoPoint {
  return {
    lon: wrapLon(v.centerLonWorld + (p.x - v.widthPx / 2) / v.pixelsPerDegree),
    lat: clampLat(v.centerLat - (p.y - v.heightPx / 2) / v.pixelsPerDegree),
  };
}

/**
 * Coordonnées monde vers point écran.
 * La longitude est ramenée au plus proche du centre, de sorte qu'un point
 * juste de l'autre côté du méridien ±180 sorte du bon côté de l'écran.
 */
export function worldToScreen(v: Viewport, g: GeoPoint): ScreenPoint {
  const deltaLon = wrapLon(g.lon - v.centerLonWorld);
  return {
    x: v.widthPx / 2 + deltaLon * v.pixelsPerDegree,
    y: v.heightPx / 2 - (g.lat - v.centerLat) * v.pixelsPerDegree,
  };
}

/** Point écran vers coordonnées locales : ce que tout outil d'édition doit faire. */
export function screenToLocal(
  v: Viewport,
  p: ScreenPoint,
  cfg: RingConfig,
  tDays: number,
): GeoPoint {
  const world = screenToWorld(v, p);
  return { lon: worldToLocalLon(world.lon, world.lat, cfg, tDays), lat: world.lat };
}

/** Étendue monde visible, en degrés. */
export function visibleSpanDeg(v: Viewport): { lonSpan: number; latSpan: number } {
  return {
    lonSpan: v.widthPx / v.pixelsPerDegree,
    latSpan: v.heightPx / v.pixelsPerDegree,
  };
}

/** Déplace la caméra d'un nombre de pixels écran. */
export function panByPixels(v: Viewport, dxPx: number, dyPx: number): Viewport {
  return normalizeViewport({
    ...v,
    centerLonWorld: v.centerLonWorld - dxPx / v.pixelsPerDegree,
    centerLat: v.centerLat + dyPx / v.pixelsPerDegree,
  });
}

/**
 * Zoome autour d'un point écran : le point visé reste sous le curseur.
 * C'est la propriété qui rend le zoom à la molette naturel.
 */
export function zoomAtPoint(v: Viewport, factor: number, anchor: ScreenPoint): Viewport {
  const before = screenToWorld(v, anchor);
  const zoomed = normalizeViewport({ ...v, pixelsPerDegree: v.pixelsPerDegree * factor });
  const after = screenToWorld(zoomed, anchor);

  return normalizeViewport({
    ...zoomed,
    centerLonWorld: zoomed.centerLonWorld + wrapLon(before.lon - after.lon),
    centerLat: zoomed.centerLat + (before.lat - after.lat),
  });
}

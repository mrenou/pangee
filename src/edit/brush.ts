/**
 * Pinceaux de relief et de biome.
 *
 * Tout est en référentiel local et en indices de cellule : la conversion depuis
 * l'écran a déjà eu lieu. Aucune dépendance au DOM, donc testable.
 * Voir docs/editeur.md.
 */

import { latOfRow, wrapX } from '@/model/coords';
import type { RasterSize } from '@/model/world';
import type { GestureRecorder } from '@/edit/patch';

export type ReliefMode = 'raise' | 'lower' | 'smooth' | 'flatten';

export interface BrushShape {
  /** Rayon en cellules. */
  readonly radius: number;
  /** 0 = bord dur, 1 = très doux. */
  readonly falloff: number;
}

export interface ReliefBrush extends BrushShape {
  readonly mode: ReliefMode;
  /** Mètres ajoutés au centre, par pas, pour raise et lower. */
  readonly strengthM: number;
  /** Altitude visée par le mode flatten. */
  readonly targetM?: number;
}

/**
 * Poids d'une cellule à la distance `d` du centre.
 * `falloff` à 0 donne un disque net, à 1 une cloche très douce.
 */
export function brushWeight(d: number, radius: number, falloff: number): number {
  if (radius <= 0) return d === 0 ? 1 : 0;
  const t = d / radius;
  if (t >= 1) return 0;
  if (falloff <= 0) return 1;
  // Interpolation de Hermite entre le bord dur et la cloche.
  const soft = (1 - t * t) * (1 - t * t);
  return 1 - falloff + falloff * soft;
}

/**
 * Le disque du pinceau est un cercle sur la planète, pas sur la grille : un
 * degré de longitude couvre moins de terrain près des pôles, donc le disque
 * s'étire en cellules à mesure qu'on monte en latitude.
 */
function columnStretch(lat: number): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  // Bornée : au pôle, le facteur diverge et le pinceau ferait le tour du monde.
  return 1 / Math.max(0.08, cos);
}

/** Applique le pinceau de relief autour d'une cellule. */
export function paintRelief(
  size: RasterSize,
  height: Float32Array,
  centerX: number,
  centerY: number,
  brush: ReliefBrush,
  recorder: GestureRecorder,
): void {
  const { width, height: rows } = size;
  const radius = Math.max(0, brush.radius);
  const stretch = columnStretch(latOfRow(centerY, rows));
  const spanX = Math.ceil(radius * stretch);

  for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy += 1) {
    const y = centerY + dy;
    if (y < 0 || y >= rows) continue;

    for (let dx = -spanX; dx <= spanX; dx += 1) {
      // La distance est mesurée en cellules ramenées à l'échelle du centre.
      const d = Math.hypot(dx / stretch, dy);
      const w = brushWeight(d, radius, brush.falloff);
      if (w <= 0) continue;

      const x = wrapX(centerX + dx, width);
      const index = y * width + x;
      const current = height[index]!;
      recorder.record(x, y, current);

      switch (brush.mode) {
        case 'raise':
          height[index] = current + brush.strengthM * w;
          break;
        case 'lower':
          height[index] = current - brush.strengthM * w;
          break;
        case 'flatten':
          height[index] = current + ((brush.targetM ?? 0) - current) * w;
          break;
        case 'smooth':
          height[index] = current + (neighbourMean(size, height, x, y) - current) * w;
          break;
      }
    }
  }
}

/** Moyenne des huit voisins, wrap en longitude, bords nord et sud repliés. */
function neighbourMean(size: RasterSize, height: Float32Array, x: number, y: number): number {
  const { width, height: rows } = size;
  let sum = 0;
  let count = 0;

  for (let dy = -1; dy <= 1; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= rows) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      sum += height[ny * width + wrapX(x + dx, width)]!;
      count += 1;
    }
  }

  return count === 0 ? height[y * width + x]! : sum / count;
}

/**
 * Applique le pinceau de biome.
 *
 * Pas de fondu : la valeur est posée pleine sur tout le disque. Un biome est
 * une catégorie, une demi-forêt n'a pas de sens. La gomme écrit 0, c'est-à-dire
 * le retour au biome automatique.
 */
export function paintBiome(
  size: RasterSize,
  biomeOverride: Uint8Array,
  centerX: number,
  centerY: number,
  shape: BrushShape,
  value: number,
  recorder: GestureRecorder,
): void {
  const { width, height: rows } = size;
  const radius = Math.max(0, shape.radius);
  const stretch = columnStretch(latOfRow(centerY, rows));
  const spanX = Math.ceil(radius * stretch);

  for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy += 1) {
    const y = centerY + dy;
    if (y < 0 || y >= rows) continue;

    for (let dx = -spanX; dx <= spanX; dx += 1) {
      if (Math.hypot(dx / stretch, dy) > radius) continue;

      const x = wrapX(centerX + dx, width);
      const index = y * width + x;
      recorder.record(x, y, biomeOverride[index]!);
      biomeOverride[index] = value;
    }
  }
}

export type FogMode = 'reveal' | 'hide';

export interface FogBrush extends BrushShape {
  readonly mode: FogMode;
  /** Part du chemin vers la valeur visée, au centre et par pas : 0 à 1. */
  readonly strength: number;
}

/**
 * Applique le pinceau de brouillard, sur la grille du brouillard.
 *
 * Révéler pousse vers 255, cacher vers 0. Les valeurs intermédiaires sont
 * voulues : elles font les bords adoucis, et un passage léger ne révèle qu'à
 * moitié. Voir docs/partage.md.
 */
export function paintFog(
  fogSize: RasterSize,
  fog: Uint8Array,
  centerX: number,
  centerY: number,
  brush: FogBrush,
  recorder: GestureRecorder,
): void {
  const { width, height: rows } = fogSize;
  const radius = Math.max(0, brush.radius);
  const stretch = columnStretch(latOfRow(centerY, rows));
  const spanX = Math.ceil(radius * stretch);
  const target = brush.mode === 'reveal' ? 255 : 0;

  for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy += 1) {
    const y = centerY + dy;
    if (y < 0 || y >= rows) continue;

    for (let dx = -spanX; dx <= spanX; dx += 1) {
      const w = brushWeight(Math.hypot(dx / stretch, dy), radius, brush.falloff);
      if (w <= 0) continue;

      const x = wrapX(centerX + dx, width);
      const index = y * width + x;
      const current = fog[index]!;
      recorder.record(x, y, current);
      const step = (target - current) * Math.min(1, brush.strength * w);
      // Arrondi vers la cible : un pas, même faible, finit par l'atteindre.
      fog[index] = current + (step > 0 ? Math.ceil(step) : Math.floor(step));
    }
  }
}

/** Remplit tout le brouillard d'une valeur : « tout révéler », « tout cacher ». */
export function fillFog(
  fogSize: RasterSize,
  fog: Uint8Array,
  value: number,
  recorder: GestureRecorder,
): void {
  const { width, height } = fogSize;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      recorder.record(x, y, fog[y * width + x]!);
    }
  }
  fog.fill(value);
}

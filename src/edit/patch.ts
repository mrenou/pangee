/**
 * Patchs rectangulaires pour l'annulation des écritures raster.
 *
 * On ne stocke jamais une couche entière : seulement la boîte englobante
 * touchée, et son contenu avant et après. Un geste de pinceau sur une planète
 * de deux millions de cellules ne coûte alors que quelques milliers de valeurs.
 * Voir docs/editeur.md.
 */

import { wrapX } from '@/model/coords';
import type { RasterSize } from '@/model/world';

export type RasterLayerName = 'height' | 'biomeOverride' | 'fog' | 'urban';

export interface RasterPatch {
  readonly layer: RasterLayerName;
  /** Abscisse de départ. Peut valoir jusqu'à `width - 1` et déborder par wrap. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly before: Float32Array | Uint8Array;
  readonly after: Float32Array | Uint8Array;
}

export function patchBytes(patch: RasterPatch): number {
  return patch.before.byteLength + patch.after.byteLength;
}

/**
 * Enregistre les valeurs d'origine des cellules touchées par un geste.
 *
 * On note la première valeur vue pour chaque cellule, jamais les suivantes :
 * annuler un trait doit rendre l'état d'avant le trait, pas celui d'avant le
 * dernier pas de souris.
 */
export class GestureRecorder {
  private readonly original = new Map<number, number>();
  private minXUnwrapped = 0;
  private maxXUnwrapped = 0;
  private minY = 0;
  private maxY = 0;
  private originX: number | undefined;

  constructor(
    readonly layer: RasterLayerName,
    private readonly size: RasterSize,
  ) {}

  get touchedCount(): number {
    return this.original.size;
  }

  /** À appeler avant d'écrire dans la cellule. */
  record(x: number, y: number, currentValue: number): void {
    const { width } = this.size;
    const cx = wrapX(x, width);
    const index = y * width + cx;

    if (this.original.has(index)) return;
    this.original.set(index, currentValue);

    // Les abscisses sont dépliées autour de la première cellule touchée : un
    // geste qui franchit le méridien ±180 reste une seule boîte étroite, au
    // lieu de s'étendre sur toute la planète.
    if (this.originX === undefined) {
      this.originX = cx;
      this.minXUnwrapped = cx;
      this.maxXUnwrapped = cx;
      this.minY = y;
      this.maxY = y;
      return;
    }

    const unwrapped = this.originX + shortestDelta(cx - this.originX, width);
    if (unwrapped < this.minXUnwrapped) this.minXUnwrapped = unwrapped;
    if (unwrapped > this.maxXUnwrapped) this.maxXUnwrapped = unwrapped;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  /**
   * Construit le patch du geste à partir de la couche dans son état courant.
   * Renvoie `undefined` si rien n'a été touché.
   */
  finish(current: Float32Array | Uint8Array): RasterPatch | undefined {
    if (this.originX === undefined) return undefined;

    const { width } = this.size;
    const w = this.maxXUnwrapped - this.minXUnwrapped + 1;
    const h = this.maxY - this.minY + 1;
    const x0 = wrapX(this.minXUnwrapped, width);

    const before =
      current instanceof Float32Array ? new Float32Array(w * h) : new Uint8Array(w * h);
    const after = current instanceof Float32Array ? new Float32Array(w * h) : new Uint8Array(w * h);

    for (let row = 0; row < h; row += 1) {
      const y = this.minY + row;
      for (let col = 0; col < w; col += 1) {
        const index = y * width + wrapX(x0 + col, width);
        after[row * w + col] = current[index]!;
        // Une cellule de la boîte que le geste n'a pas touchée n'a pas changé :
        // sa valeur d'avant est sa valeur d'aujourd'hui.
        before[row * w + col] = this.original.get(index) ?? current[index]!;
      }
    }

    return { layer: this.layer, x: x0, y: this.minY, w, h, before, after };
  }
}

/** Écart le plus court entre deux abscisses sur un cylindre de largeur `width`. */
export function shortestDelta(delta: number, width: number): number {
  const half = width / 2;
  let d = ((delta % width) + width) % width;
  if (d > half) d -= width;
  return d;
}

/** Écrit dans la couche les valeurs d'un côté du patch. */
export function applyPatch(
  patch: RasterPatch,
  target: Float32Array | Uint8Array,
  size: RasterSize,
  side: 'before' | 'after',
): void {
  const source = side === 'before' ? patch.before : patch.after;
  const { width } = size;

  for (let row = 0; row < patch.h; row += 1) {
    const y = patch.y + row;
    if (y < 0 || y >= size.height) continue;
    for (let col = 0; col < patch.w; col += 1) {
      target[y * width + wrapX(patch.x + col, width)] = source[row * patch.w + col]!;
    }
  }
}

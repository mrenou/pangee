/**
 * Mise à jour partielle d'une texture de raster.
 *
 * Réuploader les huit mégaoctets du relief à chaque pas de pinceau saturerait
 * le bus : on ne renvoie que la boîte touchée, via `texSubImage2D`. Faute
 * d'accès au contexte — un moteur WebGPU, par exemple — on retombe sur un
 * téléversement complet, correct mais lent. Voir docs/editeur.md.
 */

import type { Renderer, TextureSource } from 'pixi.js';
import { wrapX } from '@/model/coords';
import type { RasterSize } from '@/model/world';

interface GlLike {
  readonly texture: {
    getGlSource: (source: TextureSource) => { texture: WebGLTexture; target: number } | undefined;
  };
  readonly gl: WebGL2RenderingContext;
}

function glOf(renderer: Renderer): GlLike | undefined {
  const candidate = renderer as unknown as Partial<GlLike>;
  return candidate.gl && candidate.texture?.getGlSource ? (candidate as GlLike) : undefined;
}

export interface SubImageRegion {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Renvoie la boîte à téléverser, éventuellement scindée : une boîte qui
 * enjambe le méridien ±180 ne peut pas être envoyée d'un seul bloc, puisque
 * `texSubImage2D` ne connaît pas le wrap.
 */
export function splitAtSeam(region: SubImageRegion, width: number): readonly SubImageRegion[] {
  const x = wrapX(region.x, width);
  if (x + region.w <= width) return [{ ...region, x }];
  const first = width - x;
  return [
    { x, y: region.y, w: first, h: region.h },
    { x: 0, y: region.y, w: region.w - first, h: region.h },
  ];
}

/** Extrait une sous-image d'un raster, ligne par ligne. */
export function extractRegion(
  data: Float32Array,
  size: RasterSize,
  region: SubImageRegion,
): Float32Array {
  const out = new Float32Array(region.w * region.h);
  for (let row = 0; row < region.h; row += 1) {
    const from = (region.y + row) * size.width + region.x;
    out.set(data.subarray(from, from + region.w), row * region.w);
  }
  return out;
}

/**
 * Téléverse la boîte donnée. Renvoie `false` si la mise à jour partielle n'a
 * pas pu avoir lieu : l'appelant doit alors réuploader la couche entière.
 */
export function uploadRegion(
  renderer: Renderer,
  source: TextureSource,
  data: Float32Array,
  size: RasterSize,
  region: SubImageRegion,
): boolean {
  const context = glOf(renderer);
  if (!context) return false;

  const glTexture = context.texture.getGlSource(source);
  if (!glTexture) return false;

  const { gl } = context;
  const previous = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.bindTexture(gl.TEXTURE_2D, glTexture.texture);

  for (const piece of splitAtSeam(region, size.width)) {
    if (piece.w <= 0 || piece.h <= 0) continue;
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      piece.x,
      piece.y,
      piece.w,
      piece.h,
      gl.RED,
      gl.FLOAT,
      extractRegion(data, size, piece),
    );
  }

  gl.bindTexture(gl.TEXTURE_2D, previous);
  return true;
}

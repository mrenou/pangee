/**
 * Téléversement du relief vers le GPU.
 *
 * La texture est en référentiel local et répétée en longitude : c'est le
 * shader qui applique le décalage de chaque anneau. Voir docs/rendu.md.
 */

import { BufferImageSource, Texture } from 'pixi.js';
import type { RasterSize } from '@/model/world';

export interface HeightTexture {
  readonly texture: Texture;
  readonly source: BufferImageSource;
  readonly size: RasterSize;
  /** Réécrit tout ou partie du relief et déclenche le téléversement. */
  update: (height: Float32Array) => void;
  destroy: () => void;
}

export function createHeightTexture(size: RasterSize, height: Float32Array): HeightTexture {
  const source = new BufferImageSource({
    resource: height,
    width: size.width,
    height: size.height,
    format: 'r32float',
    // Le relief est interpolé à la main dans le shader : WebGL2 ne filtre pas
    // les textures flottantes sans extension.
    scaleMode: 'nearest',
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
    alphaMode: 'no-premultiply-alpha',
  });

  const texture = new Texture({ source });

  return {
    texture,
    source,
    size,
    update: (next) => {
      source.resource = next;
      source.update();
    },
    destroy: () => {
      texture.destroy(true);
    },
  };
}

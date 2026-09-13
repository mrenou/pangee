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
  /** Réécrit la couche et déclenche le téléversement. */
  update: (data: Float32Array) => void;
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

/**
 * Texture d'une couche dérivée, en référentiel monde.
 *
 * Le wrap est le même qu'en local — la planète reste un cylindre — mais aucun
 * décalage ne lui est appliqué : la couche est déjà assemblée pour la date
 * courante par le worker. Voir docs/hydrologie.md.
 */
export function createWorldTexture(size: RasterSize, data: Float32Array): HeightTexture {
  return createHeightTexture(size, data);
}

/**
 * Couche catégorielle, un octet par cellule : le shader relit l'identifiant en
 * multipliant par 255. Aucun filtrage, sous peine de fabriquer des biomes qui
 * n'existent pas entre deux voisins.
 */
export function createByteTexture(size: RasterSize, data: Uint8Array): HeightTexture {
  const source = new BufferImageSource({
    resource: data,
    width: size.width,
    height: size.height,
    format: 'r8unorm',
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
    update: () => source.update(),
    destroy: () => texture.destroy(true),
  };
}

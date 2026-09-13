/**
 * Tracé des cours d'eau à l'encre.
 *
 * Les polylignes arrivent en degrés ; le conteneur porte la transformation de
 * caméra, de sorte qu'un déplacement ne coûte qu'une position. Seul un
 * changement de zoom impose de redessiner, pour que l'épaisseur du trait reste
 * constante à l'écran. Voir docs/rendu.md.
 */

import { Container, Graphics } from 'pixi.js';
import type { RiverNetwork } from '@/hydro/rivers';
import type { Viewport } from '@/model/viewport';

/** Épaisseur à l'écran d'un ruisseau au seuil, en pixels. */
const BASE_WIDTH_PX = 0.9;

const RIVER_INK = 0x4a6670;

/**
 * Le monde est répété de part et d'autre pour que le wrap est-ouest soit
 * invisible. Trois copies suffisent : au zoom le plus large, la planète tient
 * une seule fois à l'écran.
 */
const REPEATS = [-360, 0, 360] as const;

export interface RiverLayer {
  readonly container: Container;
  setNetwork: (network: RiverNetwork | undefined) => void;
  setViewport: (viewport: Viewport) => void;
  destroy: () => void;
}

export function createRiverLayer(): RiverLayer {
  const container = new Container();
  const copies = REPEATS.map(() => {
    const graphics = new Graphics();
    container.addChild(graphics);
    return graphics;
  });

  let network: RiverNetwork | undefined;
  let drawnAtPixelsPerDegree = 0;

  const draw = (pixelsPerDegree: number): void => {
    drawnAtPixelsPerDegree = pixelsPerDegree;
    for (const graphics of copies) graphics.clear();
    if (!network || pixelsPerDegree <= 0) return;

    const { points, starts } = network;
    const riverCount = Math.max(0, starts.length - 1);

    for (const graphics of copies) {
      for (let r = 0; r < riverCount; r += 1) {
        const from = starts[r]!;
        const to = starts[r + 1]!;
        if (to - from < 2) continue;

        // L'épaisseur varie le long du cours d'eau : on trace segment par
        // segment, chacun à la largeur de son point amont.
        for (let p = from; p < to - 1; p += 1) {
          const width = points[p * 3 + 2]!;
          graphics
            .moveTo(points[p * 3]!, points[p * 3 + 1]!)
            .lineTo(points[(p + 1) * 3]!, points[(p + 1) * 3 + 1]!)
            .stroke({
              // Les coordonnées sont en degrés : on convertit l'épaisseur
              // voulue à l'écran en degrés pour compenser l'échelle.
              width: (BASE_WIDTH_PX * width) / pixelsPerDegree,
              color: RIVER_INK,
              alpha: 0.85,
              cap: 'round',
              join: 'round',
            });
        }
      }
    }
  };

  const setViewport = (viewport: Viewport): void => {
    const { pixelsPerDegree, centerLonWorld, centerLat, widthPx, heightPx } = viewport;

    if (pixelsPerDegree !== drawnAtPixelsPerDegree) draw(pixelsPerDegree);

    // La latitude croît vers le nord, l'écran vers le sud : l'échelle en y est
    // négative.
    container.scale.set(pixelsPerDegree, -pixelsPerDegree);
    container.position.set(
      widthPx / 2 - centerLonWorld * pixelsPerDegree,
      heightPx / 2 + centerLat * pixelsPerDegree,
    );

    copies.forEach((graphics, i) => {
      graphics.position.x = REPEATS[i]!;
    });
  };

  return {
    container,
    setNetwork: (next) => {
      network = next;
      draw(drawnAtPixelsPerDegree);
    },
    setViewport,
    destroy: () => container.destroy({ children: true }),
  };
}

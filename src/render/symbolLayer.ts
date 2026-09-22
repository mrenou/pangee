/**
 * Semis des symboles de relief sur la carte.
 *
 * Les symboles sont placés sur une grille en degrés, avec un pas choisi pour
 * qu'ils gardent un espacement constant à l'écran, et un décalage tiré d'un
 * hash de la case — donc stable : déplacer la carte ne les fait pas danser.
 * Voir docs/rendu.md.
 */

import { Container, Graphics } from 'pixi.js';
import { Biome } from '@/climate';
import { columnOfLon, idx, rowOfLat } from '@/model/coords';
import type { Viewport } from '@/model/viewport';
import type { RasterSize } from '@/model/world';
import { FINE_STEP_DEG, seedPoint, strideFor } from '@/render/seedGrid';
import { isSubmerged } from '@/render/waterSurface';
import {
  drawConifer,
  drawDune,
  drawHill,
  drawMarsh,
  drawMountain,
  drawTree,
} from '@/render/symbols';

/** Espacement visé entre deux symboles, en pixels écran. */
const SPACING_PX = 26;

/** Hauteur d'un symbole, en pixels écran. */
const SYMBOL_PX = 17;

/** Plafond de symboles dessinés : au-delà, la carte devient illisible. */
const MAX_SYMBOLS = 4000;

/** Marge dessinée autour de la zone visible, en fraction de l'écran. */
const MARGIN = 0.25;

const MOUNTAIN_M = 1100;
const HILL_M = 420;

export interface TerrainSample {
  readonly size: RasterSize;
  readonly heightWorld: Float32Array;
  readonly biome: Uint8Array;
  readonly waterLevel: Float32Array;
  readonly seaLevelM: number;
}

export interface SymbolLayer {
  readonly container: Container;
  setTerrain: (sample: TerrainSample | undefined) => void;
  setViewport: (viewport: Viewport) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

export function createSymbolLayer(): SymbolLayer {
  const container = new Container();
  const graphics = new Graphics();
  container.addChild(graphics);

  let sample: TerrainSample | undefined;
  let lastKey = '';
  let lastViewport: Viewport | undefined;

  const draw = (viewport: Viewport): void => {
    graphics.clear();
    if (!sample) return;

    const { pixelsPerDegree, centerLonWorld, centerLat, widthPx, heightPx } = viewport;
    const symbolDeg = SYMBOL_PX / pixelsPerDegree;

    const halfLon = (widthPx / 2 / pixelsPerDegree) * (1 + MARGIN);
    const halfLat = (heightPx / 2 / pixelsPerDegree) * (1 + MARGIN);

    // Le pas de parcours s'ajuste au zoom, la grille reste celle du monde : un
    // symbole ne bouge donc jamais, il apparaît ou disparaît.
    const stride = strideFor(pixelsPerDegree, SPACING_PX);
    const align = (value: number): number => Math.floor(value / FINE_STEP_DEG / stride) * stride;

    const fromI = align(centerLonWorld - halfLon);
    const toI = align(centerLonWorld + halfLon) + stride;
    const fromJ = align(centerLat - halfLat);
    const toJ = align(centerLat + halfLat) + stride;

    const { size, heightWorld, biome, waterLevel, seaLevelM } = sample;
    let drawn = 0;

    for (let j = fromJ; j <= toJ && drawn < MAX_SYMBOLS; j += stride) {
      for (let i = fromI; i <= toI && drawn < MAX_SYMBOLS; i += stride) {
        const { lon, lat, r1, r2, r3 } = seedPoint(i, j);
        if (lat > 89 || lat < -89) continue;

        const cell = idx(columnOfLon(lon, size.width), rowOfLat(lat, size.height), size.width);

        // Rien ne pousse sur l'eau, selon la même règle que le shader.
        if (isSubmerged(heightWorld[cell]!, seaLevelM, waterLevel[cell])) continue;

        const altitude = heightWorld[cell]! - seaLevelM;
        if (altitude <= 0) continue;

        const b = biome[cell]!;
        // Des figures toutes identiques auraient l'air imprimées : chacune
        // prend sa taille propre.
        const scale = 0.75 + r1 * 0.55;
        const unit = symbolDeg * scale;
        const y = lat - unit * 0.35;

        if (altitude > MOUNTAIN_M || b === Biome.Alpine) {
          // Les montagnes sont denses : elles forment des chaînes.
          if (r3 > 0.82) continue;
          // Les plus hauts sommets se dessinent plus grands.
          const relief = Math.min(1.6, 0.95 + (altitude - MOUNTAIN_M) / 3000);
          drawMountain(graphics, lon, y, unit * relief, r2 > 0.5 ? 1 : -1);
        } else if (altitude > HILL_M) {
          if (r3 > 0.5) continue;
          drawHill(graphics, lon, y, unit);
        } else if (b === Biome.Taiga) {
          if (r3 > 0.62) continue;
          drawConifer(graphics, lon, y, unit * 0.9);
        } else if (
          b === Biome.TemperateForest ||
          b === Biome.TemperateRainforest ||
          b === Biome.TropicalForest ||
          b === Biome.TropicalRainforest
        ) {
          if (r3 > 0.62) continue;
          drawTree(graphics, lon, y, unit * 0.85);
        } else if (b === Biome.Desert) {
          if (r3 > 0.38) continue;
          drawDune(graphics, lon, y, unit * 0.8);
        } else if (b === Biome.Marsh) {
          if (r3 > 0.55) continue;
          drawMarsh(graphics, lon, y, unit * 0.8);
        } else {
          continue;
        }

        drawn += 1;
      }
    }
  };

  const setViewport = (viewport: Viewport): void => {
    lastViewport = viewport;
    const { pixelsPerDegree, centerLonWorld, centerLat, widthPx, heightPx } = viewport;

    container.scale.set(pixelsPerDegree, -pixelsPerDegree);
    container.position.set(
      widthPx / 2 - centerLonWorld * pixelsPerDegree,
      heightPx / 2 + centerLat * pixelsPerDegree,
    );

    // On ne redessine que lorsque la zone semée doit changer : le pan glisse
    // dans la marge sans reconstruire quoi que ce soit.
    const stride = strideFor(pixelsPerDegree, SPACING_PX);
    const window = FINE_STEP_DEG * stride * 4;
    const key = [
      stride,
      pixelsPerDegree.toFixed(3),
      Math.round(centerLonWorld / window),
      Math.round(centerLat / window),
    ].join(':');
    if (key === lastKey) return;
    lastKey = key;
    draw(viewport);
  };

  return {
    container,
    setTerrain: (next) => {
      sample = next;
      lastKey = '';
      // Sans ce tracé immédiat, les symboles gardaient l'ancien relief jusqu'au
      // prochain mouvement de caméra : une montagne rasée restait dessinée.
      if (lastViewport) draw(lastViewport);
    },
    setViewport,
    setVisible: (visible) => {
      container.visible = visible;
    },
    destroy: () => container.destroy({ children: true }),
  };
}

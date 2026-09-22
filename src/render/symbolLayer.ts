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
import { ringOf, type RingConfig } from '@/model/ring';
import { ringOffsetDeg } from '@/model/time';
import type { Viewport } from '@/model/viewport';
import type { RasterSize } from '@/model/world';
import {
  FINE_STEP_DEG,
  keepFraction,
  seedPoint,
  seedPointInWorld,
  strideFor,
} from '@/render/seedGrid';
import { isSubmerged } from '@/render/waterSurface';
import { worldLagDeg } from '@/render/worldLag';
import { SYMBOL_PASSES, closePass, emitSymbol, type PlacedSymbol } from '@/render/symbols';

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
  /** Date à laquelle ces couches ont été assemblées. */
  readonly tDays: number;
}

export interface SymbolLayer {
  readonly container: Container;
  setTerrain: (sample: TerrainSample | undefined) => void;
  /** Date et anneaux : le semis est ancré au monde d'avant le Cataclysme. */
  setTime: (ringConfig: RingConfig, tDays: number) => void;
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
  let ringConfig: RingConfig | undefined;
  let tDays = 0;

  const draw = (viewport: Viewport): void => {
    // Le cache doit être levé avant de retoucher les tracés, sinon on peindrait
    // sous une image figée.
    container.cacheAsTexture(false);
    graphics.clear();
    if (!sample) return;

    const { pixelsPerDegree, centerLonWorld, centerLat, widthPx, heightPx } = viewport;
    const symbolDeg = SYMBOL_PX / pixelsPerDegree;

    const halfLon = (widthPx / 2 / pixelsPerDegree) * (1 + MARGIN);
    const halfLat = (heightPx / 2 / pixelsPerDegree) * (1 + MARGIN);

    // Le pas de parcours s'ajuste au zoom, la grille reste celle du monde : un
    // symbole ne bouge donc jamais, il apparaît ou disparaît.
    const stride = strideFor(pixelsPerDegree, SPACING_PX);
    // Entre deux paliers, la grille est jusqu'à deux fois trop serrée : on en
    // écarte une part pour garder un espacement constant à l'écran.
    const keep = keepFraction(stride, pixelsPerDegree, SPACING_PX);
    const align = (value: number): number => Math.floor(value / FINE_STEP_DEG / stride) * stride;

    const fromJ = align(centerLat - halfLat);
    const toJ = align(centerLat + halfLat) + stride;

    const { size, heightWorld, biome, waterLevel, seaLevelM } = sample;
    const cfg = ringConfig;
    let drawn = 0;

    // Les symboles sont d'abord recensés, puis tracés par passes de style :
    // un seul trait pour tous les contours, un seul aplat pour tous les
    // feuillages. Les terminer un par un ouvrait des milliers d'instructions
    // de dessin par image.
    const placed: PlacedSymbol[] = [];

    for (let j = fromJ; j <= toJ && drawn < MAX_SYMBOLS; j += stride) {
      // La grille est en référentiel local : un symbole reste accroché à son
      // morceau de terrain et glisse avec son anneau. L'ancrer au référentiel
      // monde laissait le relief défiler sous un semis immobile, et les
      // montagnes changeaient de forme à mesure que le continent passait.
      const rowLat = (j + 0.5) * FINE_STEP_DEG;
      const offsetDeg = cfg ? ringOffsetDeg(cfg.rings[ringOf(rowLat, cfg)], tDays, cfg.t0) : 0;

      // Le relief assemblé date du dernier calcul : on le lit à la position
      // qu'il occupait alors. Sans cela les symboles se déplaçaient bien tout
      // de suite, mais se posaient sur un relief périmé, et les montagnes ne
      // rattrapaient le continent qu'au calcul suivant.
      const lagDeg = cfg ? worldLagDeg(cfg, rowLat, tDays, sample.tDays) : 0;

      const fromI = align(centerLonWorld - halfLon - offsetDeg);
      const toI = align(centerLonWorld + halfLon - offsetDeg) + stride;

      for (let i = fromI; i <= toI && drawn < MAX_SYMBOLS; i += stride) {
        // Position affichée : le point vit en local et suit son anneau. Le
        // terrain est lu au même endroit, les couches dérivées étant déjà en
        // référentiel monde.
        const { lon, lat, r1, r2, r3, r4 } = cfg
          ? seedPointInWorld(i, j, cfg, tDays)
          : seedPoint(i, j);
        if (r4 >= keep) continue;
        if (lat > 89 || lat < -89) continue;

        const cell = idx(
          columnOfLon(lon - lagDeg, size.width),
          rowOfLat(lat, size.height),
          size.width,
        );

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
          placed.push({
            kind: 'mountain',
            x: lon,
            y,
            size: unit * relief,
            lean: r2 > 0.5 ? 1 : -1,
          });
        } else if (altitude > HILL_M) {
          if (r3 > 0.5) continue;
          placed.push({ kind: 'hill', x: lon, y, size: unit, lean: 1 });
        } else if (b === Biome.Taiga) {
          if (r3 > 0.62) continue;
          placed.push({ kind: 'conifer', x: lon, y, size: unit * 0.9, lean: 1 });
        } else if (
          b === Biome.TemperateForest ||
          b === Biome.TemperateRainforest ||
          b === Biome.TropicalForest ||
          b === Biome.TropicalRainforest
        ) {
          if (r3 > 0.62) continue;
          placed.push({ kind: 'tree', x: lon, y, size: unit * 0.85, lean: 1 });
        } else if (b === Biome.Desert) {
          if (r3 > 0.38) continue;
          placed.push({ kind: 'dune', x: lon, y, size: unit * 0.8, lean: 1 });
        } else if (b === Biome.Marsh) {
          if (r3 > 0.55) continue;
          placed.push({ kind: 'marsh', x: lon, y, size: unit * 0.8, lean: 1 });
        } else {
          continue;
        }

        drawn += 1;
      }
    }

    for (const pass of SYMBOL_PASSES) {
      let emitted = false;
      for (const symbol of placed) {
        emitSymbol(graphics, symbol, pass);
        emitted = true;
      }
      if (emitted) closePass(graphics, pass, symbolDeg);
    }

    // Quelques milliers de traits à rastériser, à chaque image, pour un semis
    // qui ne change qu'aux paliers de zoom : mesuré, cela coûtait près d'un
    // quart de la fluidité même carte immobile. On le fige donc en une texture,
    // reconstruite aux mêmes moments que le semis lui-même.
    //
    // La résolution doit être celle de l'écran, et non celle du repère local :
    // les figures y mesurent des fractions de degré, et le cache les réduisait
    // à quelques pixels flous avant de les réétirer.
    if (placed.length > 0) container.cacheAsTexture({ resolution: pixelsPerDegree });
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

    // Le zoom n'entre dans la clé que par paliers grossiers. Reconstruire
    // plusieurs milliers de tracés à chaque cran de molette rendait le zoom
    // saccadé, alors que le semis, lui, ne change qu'au palier suivant. Entre
    // deux, c'est la mise à l'échelle du conteneur qui fait le travail.
    const zoomStep = Math.round(Math.log2(pixelsPerDegree) * 3);
    const key = [
      stride,
      tDays,
      zoomStep,
      Math.round(centerLonWorld / window),
      Math.round(centerLat / window),
    ].join(':');
    if (key === lastKey) return;
    lastKey = key;
    draw(viewport);
  };

  return {
    container,
    setTime: (config, days) => {
      ringConfig = config;
      tDays = days;
      lastKey = '';
      if (lastViewport) draw(lastViewport);
    },
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

/**
 * Moteur de rendu de la carte.
 *
 * Affiche, ne décide de rien : il reçoit un instantané du monde et le dessine.
 * Voir docs/rendu.md.
 */

import { Application, Geometry, Mesh, Shader, UniformGroup } from 'pixi.js';
import { ringOffsetsDeg } from '@/model/time';
import type { RingConfig as RingConfigType } from '@/model/ring';
import { normalizeViewport, visibleSpanDeg, type Viewport } from '@/model/viewport';
import type { RingConfig } from '@/model/ring';
import type { RasterSize } from '@/model/world';
import type { RiverNetwork } from '@/hydro/rivers';
import type { Place, Road } from '@/model/world';
import type { Point } from '@/edit/roads';
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX } from '@/render/terrainShader';
import { biomePaletteArray } from '@/render/palette';
import { createLabelLayer } from '@/render/labelLayer';
import { createRiverLayer } from '@/render/riverLayer';
import { createRoadLayer } from '@/render/roadLayer';
import { uploadRegion, type SubImageRegion } from '@/render/textureUpdate';
import { createSymbolLayer, type TerrainSample } from '@/render/symbolLayer';
import {
  createByteTexture,
  createHeightTexture,
  createWorldTexture,
  type HeightTexture,
} from '@/render/terrainTexture';

export interface TerrainView {
  readonly ringConfig: RingConfig;
  readonly tDays: number;
  readonly seaLevelM: number;
  readonly maxAltitudeM: number;
  readonly maxDepthM: number;
  readonly showFaults: boolean;
  /** Habillage « carte de livre » : parchemin, hachures, teintes de biome. */
  readonly bookStyle: boolean;
}

export interface MapRenderer {
  readonly app: Application;
  /** Relief à afficher. Remplace la texture existante. */
  setHeight: (size: RasterSize, height: Float32Array) => void;
  setViewport: (viewport: Viewport) => void;
  setView: (view: TerrainView) => void;
  /** Couches d'eau calculées par le worker, en référentiel monde. */
  /** Relief assemblé et biomes, pour le semis des symboles. */
  setTerrainSample: (sample: TerrainSample) => void;
  /** Lieux à nommer, en référentiel local. */
  setPlaces: (places: readonly Place[]) => void;
  /** Routes, en référentiel local. */
  setRoads: (roads: readonly Road[]) => void;
  /** Tracé en cours, pas encore validé. */
  setDraftRoad: (points: readonly Point[]) => void;
  /**
   * Renvoie au GPU la zone du relief modifiée par un coup de pinceau.
   * `undefined` réuploade toute la couche.
   */
  refreshHeight: (region?: SubImageRegion) => void;
  /** Réuploade la couche d'override de biome. */
  refreshBiomeOverride: (data: Uint8Array) => void;
  setWater: (
    size: RasterSize,
    waterLevel: Float32Array,
    flowAcc: Float32Array,
    biome: Uint8Array,
    rivers: RiverNetwork,
    riverThreshold: number,
    /** Date à laquelle ces couches ont été calculées. */
    tDays: number,
  ) => void;
  /** Taille courante du canvas, en pixels CSS. */
  screenSize: () => { widthPx: number; heightPx: number };
  destroy: () => void;
}

const PARCHMENT_BACKGROUND = 0xd4c4a0;

export async function createMapRenderer(host: HTMLElement): Promise<MapRenderer> {
  const app = new Application();
  await app.init({
    background: PARCHMENT_BACKGROUND,
    resizeTo: host,
    antialias: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
  });
  host.appendChild(app.canvas);

  const uniforms = new UniformGroup({
    uCenter: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
    uViewSpanDeg: { value: new Float32Array([360, 180]), type: 'vec2<f32>' },
    uRingOffsetDeg: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
    uWaterRingOffsetDeg: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
    uCutLat: { value: new Float32Array([30, -30]), type: 'vec2<f32>' },
    uRasterSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    uSeaLevelM: { value: 0, type: 'f32' },
    uMaxAltitudeM: { value: 6000, type: 'f32' },
    uMaxDepthM: { value: 8000, type: 'f32' },
    uShowFaults: { value: 1, type: 'f32' },
    uHasWater: { value: 0, type: 'f32' },
    uRiverThreshold: { value: 1e9, type: 'f32' },
    uStyle: { value: 1, type: 'f32' },
    uBiomeColor: { value: biomePaletteArray(), type: 'vec3<f32>', size: 14 },
  });

  // Un seul texel tant qu'aucun relief n'est arrivé : le shader a besoin d'une
  // texture valide dès la première image.
  const onePixel: RasterSize = { width: 1, height: 1 };
  let heightTexture: HeightTexture = createHeightTexture(onePixel, new Float32Array([0]));
  let waterTexture: HeightTexture = createWorldTexture(onePixel, new Float32Array([0]));
  let flowTexture: HeightTexture = createWorldTexture(onePixel, new Float32Array([0]));
  let biomeTexture: HeightTexture = createByteTexture(onePixel, new Uint8Array([0]));

  const shader = Shader.from({
    gl: { vertex: TERRAIN_VERTEX, fragment: TERRAIN_FRAGMENT },
    resources: {
      uHeight: heightTexture.texture.source,
      uHeightSampler: heightTexture.texture.source.style,
      uWaterLevel: waterTexture.texture.source,
      uWaterLevelSampler: waterTexture.texture.source.style,
      uFlowAcc: flowTexture.texture.source,
      uFlowAccSampler: flowTexture.texture.source.style,
      uBiome: biomeTexture.texture.source,
      uBiomeSampler: biomeTexture.texture.source.style,
      uniforms,
    },
  });

  // Quad unitaire, étiré à la taille de l'écran par la matrice du mesh.
  // Géométrie nue plutôt qu'un MeshGeometry : ce dernier déclare toujours un
  // attribut d'UV, que ce shader n'utilise pas — il dérive tout de la position
  // — et PixiJS s'en plaint à chaque démarrage.
  const geometry = new Geometry({
    attributes: { aPosition: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });

  const mesh = new Mesh({ geometry, shader });
  app.stage.addChild(mesh);

  const symbolLayer = createSymbolLayer();
  app.stage.addChild(symbolLayer.container);

  const riverLayer = createRiverLayer();
  app.stage.addChild(riverLayer.container);

  const roadLayer = createRoadLayer();
  app.stage.addChild(roadLayer.container);

  // Les lieux passent au-dessus de tout : ce sont eux qu'on lit en premier.
  const labelLayer = createLabelLayer();
  app.stage.addChild(labelLayer.container);

  const resizeMesh = (): void => {
    mesh.scale.set(app.screen.width, app.screen.height);
  };
  resizeMesh();
  app.renderer.on('resize', resizeMesh);

  /**
   * Redessine une fois.
   *
   * Pixi ne re-rend que lorsque la scène a changé : remplacer une texture ou un
   * uniforme ne l'en informe pas, et l'image restait figée jusqu'au prochain
   * mouvement de caméra. On le lui demande donc explicitement.
   */
  /**
   * Textures remplacées, en attente de libération.
   *
   * Détruire une source encore liée au shader laisse le groupe de liaison
   * invalide : PixiJS le signale, et selon le pilote le terrain cesse d'être
   * dessiné. On attend donc le rendu suivant, qui reconstruit la liaison sur
   * les nouvelles sources, avant de libérer les anciennes.
   */
  const retired: HeightTexture[] = [];

  const invalidate = (): void => {
    app.renderer.render(app.stage);
    while (retired.length > 0) retired.pop()?.destroy();
  };

  /** Dernière configuration reçue, pour dater les couches d'eau. */
  let lastRingConfig: RingConfigType | undefined;

  const screenSize = (): { widthPx: number; heightPx: number } => ({
    widthPx: app.screen.width,
    heightPx: app.screen.height,
  });

  const setViewport = (viewport: Viewport): void => {
    const v = normalizeViewport(viewport);
    const span = visibleSpanDeg(v);
    const center = uniforms.uniforms.uCenter as Float32Array;
    const viewSpan = uniforms.uniforms.uViewSpanDeg as Float32Array;
    center[0] = v.centerLonWorld;
    center[1] = v.centerLat;
    viewSpan[0] = span.lonSpan;
    viewSpan[1] = span.latSpan;
    uniforms.update();
    symbolLayer.setViewport(v);
    riverLayer.setViewport(v);
    roadLayer.setViewport(v);
    labelLayer.setViewport(v);
    invalidate();
  };

  const setView = (view: TerrainView): void => {
    lastRingConfig = view.ringConfig;
    const offsets = ringOffsetsDeg(view.ringConfig, view.tDays);
    const ringOffset = uniforms.uniforms.uRingOffsetDeg as Float32Array;
    const cut = uniforms.uniforms.uCutLat as Float32Array;
    ringOffset[0] = offsets.north;
    ringOffset[1] = offsets.equator;
    ringOffset[2] = offsets.south;
    cut[0] = view.ringConfig.cutNorthLat;
    cut[1] = view.ringConfig.cutSouthLat;
    uniforms.uniforms.uSeaLevelM = view.seaLevelM;
    uniforms.uniforms.uMaxAltitudeM = view.maxAltitudeM;
    uniforms.uniforms.uMaxDepthM = view.maxDepthM;
    uniforms.uniforms.uShowFaults = view.showFaults ? 1 : 0;
    uniforms.uniforms.uStyle = view.bookStyle ? 1 : 0;
    symbolLayer.setVisible(view.bookStyle);
    labelLayer.setTime(view.ringConfig, view.tDays);
    roadLayer.setTime(view.ringConfig, view.tDays);
    symbolLayer.setTime(view.ringConfig, view.tDays);
    riverLayer.setTime(view.ringConfig, view.tDays);
    uniforms.update();
  };

  const setHeight = (size: RasterSize, height: Float32Array): void => {
    if (sameSize(heightTexture, size)) {
      heightTexture.update(height);
    } else {
      retired.push(heightTexture);
      heightTexture = createHeightTexture(size, height);
      shader.resources.uHeight = heightTexture.texture.source;
      shader.resources.uHeightSampler = heightTexture.texture.source.style;
    }

    const rasterSize = uniforms.uniforms.uRasterSize as Float32Array;
    rasterSize[0] = size.width;
    rasterSize[1] = size.height;
    uniforms.update();
    invalidate();
  };

  const sameSize = (texture: HeightTexture, size: RasterSize): boolean =>
    texture.size.width === size.width && texture.size.height === size.height;

  const setWater = (
    size: RasterSize,
    waterLevel: Float32Array,
    flowAcc: Float32Array,
    biome: Uint8Array,
    rivers: RiverNetwork,
    riverThreshold: number,
    tDays: number,
  ): void => {
    // Réécrire le contenu plutôt que remplacer la texture. Détruire une source
    // encore liée au shader laisse le groupe de liaison invalide : PixiJS le
    // signale, et selon le pilote le terrain cesse purement et simplement
    // d'être dessiné. C'est aussi plus rapide, rien n'étant réalloué.
    if (sameSize(waterTexture, size)) {
      waterTexture.update(waterLevel);
      flowTexture.update(flowAcc);
      biomeTexture.update(biome);
    } else {
      retired.push(waterTexture, flowTexture, biomeTexture);
      waterTexture = createWorldTexture(size, waterLevel);
      flowTexture = createWorldTexture(size, flowAcc);
      biomeTexture = createByteTexture(size, biome);
      shader.resources.uWaterLevel = waterTexture.texture.source;
      shader.resources.uWaterLevelSampler = waterTexture.texture.source.style;
      shader.resources.uFlowAcc = flowTexture.texture.source;
      shader.resources.uFlowAccSampler = flowTexture.texture.source.style;
      shader.resources.uBiome = biomeTexture.texture.source;
      shader.resources.uBiomeSampler = biomeTexture.texture.source.style;
    }

    uniforms.uniforms.uHasWater = 1;
    uniforms.uniforms.uRiverThreshold = riverThreshold;

    // Les couches arrivent datées : le shader compense ce que les anneaux ont
    // parcouru depuis, pour que l'eau glisse avec la terre au lieu de rester
    // là où elle n'est plus.
    if (lastRingConfig) {
      const at = ringOffsetsDeg(lastRingConfig, tDays);
      const waterOffset = uniforms.uniforms.uWaterRingOffsetDeg as Float32Array;
      waterOffset[0] = at.north;
      waterOffset[1] = at.equator;
      waterOffset[2] = at.south;
    }

    uniforms.update();
    riverLayer.setNetwork(rivers, tDays);
    invalidate();
  };

  return {
    app,
    setHeight,
    setViewport,
    setView,
    setWater,
    setTerrainSample: (next) => {
      symbolLayer.setTerrain(next);
      invalidate();
    },
    setPlaces: (next) => labelLayer.setPlaces(next),
    setRoads: (next) => roadLayer.setRoads(next),
    setDraftRoad: (next) => roadLayer.setDraft(next),

    refreshHeight: (region) => {
      const data = heightTexture.source.resource as Float32Array;
      const partial =
        region !== undefined &&
        uploadRegion(app.renderer, heightTexture.texture.source, data, heightTexture.size, region);
      if (!partial) heightTexture.source.update();
      invalidate();
    },

    refreshBiomeOverride: (data) => {
      // L'override n'est pas encore une texture à part : il est relu par le
      // worker au prochain calcul de climat. Voir docs/rendu.md.
      void data;
    },
    screenSize,
    destroy: () => {
      app.renderer.off('resize', resizeMesh);
      riverLayer.destroy();
      roadLayer.destroy();
      symbolLayer.destroy();
      labelLayer.destroy();

      // L'application d'abord, les textures ensuite : les libérer tant que le
      // shader les référence encore laisse un groupe de liaison invalide, et
      // PixiJS le signale à chaque démontage.
      app.destroy(true, { children: true });
      for (const texture of [heightTexture, waterTexture, flowTexture, biomeTexture, ...retired]) {
        texture.destroy();
      }
      retired.length = 0;
    },
  };
}

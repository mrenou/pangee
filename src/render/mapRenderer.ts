/**
 * Moteur de rendu de la carte.
 *
 * Affiche, ne décide de rien : il reçoit un instantané du monde et le dessine.
 * Voir docs/rendu.md.
 */

import { Application, Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';
import { ringOffsetsDeg } from '@/model/time';
import { normalizeViewport, visibleSpanDeg, type Viewport } from '@/model/viewport';
import type { RingConfig } from '@/model/ring';
import type { RasterSize } from '@/model/world';
import type { RiverNetwork } from '@/hydro/rivers';
import type { Place } from '@/model/world';
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX } from '@/render/terrainShader';
import { biomePaletteArray } from '@/render/palette';
import { createLabelLayer } from '@/render/labelLayer';
import { createRiverLayer } from '@/render/riverLayer';
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
  setWater: (
    size: RasterSize,
    waterLevel: Float32Array,
    flowAcc: Float32Array,
    biome: Uint8Array,
    rivers: RiverNetwork,
    riverThreshold: number,
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
  const geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });

  const mesh = new Mesh({ geometry, shader });
  app.stage.addChild(mesh);

  const symbolLayer = createSymbolLayer();
  app.stage.addChild(symbolLayer.container);

  const riverLayer = createRiverLayer();
  app.stage.addChild(riverLayer.container);

  // Les lieux passent au-dessus de tout : ce sont eux qu'on lit en premier.
  const labelLayer = createLabelLayer();
  app.stage.addChild(labelLayer.container);

  const resizeMesh = (): void => {
    mesh.scale.set(app.screen.width, app.screen.height);
  };
  resizeMesh();
  app.renderer.on('resize', resizeMesh);

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
    labelLayer.setViewport(v);
  };

  const setView = (view: TerrainView): void => {
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
    uniforms.update();
  };

  const setHeight = (size: RasterSize, height: Float32Array): void => {
    const previous = heightTexture;
    heightTexture = createHeightTexture(size, height);
    shader.resources.uHeight = heightTexture.texture.source;
    shader.resources.uHeightSampler = heightTexture.texture.source.style;
    const rasterSize = uniforms.uniforms.uRasterSize as Float32Array;
    rasterSize[0] = size.width;
    rasterSize[1] = size.height;
    uniforms.update();
    previous.destroy();
  };

  const setWater = (
    size: RasterSize,
    waterLevel: Float32Array,
    flowAcc: Float32Array,
    biome: Uint8Array,
    rivers: RiverNetwork,
    riverThreshold: number,
  ): void => {
    const previous = [waterTexture, flowTexture, biomeTexture];
    waterTexture = createWorldTexture(size, waterLevel);
    flowTexture = createWorldTexture(size, flowAcc);
    biomeTexture = createByteTexture(size, biome);
    shader.resources.uWaterLevel = waterTexture.texture.source;
    shader.resources.uWaterLevelSampler = waterTexture.texture.source.style;
    shader.resources.uFlowAcc = flowTexture.texture.source;
    shader.resources.uFlowAccSampler = flowTexture.texture.source.style;
    shader.resources.uBiome = biomeTexture.texture.source;
    shader.resources.uBiomeSampler = biomeTexture.texture.source.style;
    uniforms.uniforms.uHasWater = 1;
    uniforms.uniforms.uRiverThreshold = riverThreshold;
    uniforms.update();
    riverLayer.setNetwork(rivers);
    for (const texture of previous) texture.destroy();
  };

  return {
    app,
    setHeight,
    setViewport,
    setView,
    setWater,
    setTerrainSample: (next) => symbolLayer.setTerrain(next),
    setPlaces: (next) => labelLayer.setPlaces(next),
    screenSize,
    destroy: () => {
      app.renderer.off('resize', resizeMesh);
      riverLayer.destroy();
      symbolLayer.destroy();
      labelLayer.destroy();
      heightTexture.destroy();
      waterTexture.destroy();
      flowTexture.destroy();
      biomeTexture.destroy();
      app.destroy(true, { children: true });
    },
  };
}

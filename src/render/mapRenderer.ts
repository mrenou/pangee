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
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX } from '@/render/terrainShader';
import {
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
}

export interface MapRenderer {
  readonly app: Application;
  /** Relief à afficher. Remplace la texture existante. */
  setHeight: (size: RasterSize, height: Float32Array) => void;
  setViewport: (viewport: Viewport) => void;
  setView: (view: TerrainView) => void;
  /** Couches d'eau calculées par le worker, en référentiel monde. */
  setWater: (
    size: RasterSize,
    waterLevel: Float32Array,
    flowAcc: Float32Array,
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
  });

  // Un seul texel tant qu'aucun relief n'est arrivé : le shader a besoin d'une
  // texture valide dès la première image.
  const onePixel: RasterSize = { width: 1, height: 1 };
  let heightTexture: HeightTexture = createHeightTexture(onePixel, new Float32Array([0]));
  let waterTexture: HeightTexture = createWorldTexture(onePixel, new Float32Array([0]));
  let flowTexture: HeightTexture = createWorldTexture(onePixel, new Float32Array([0]));

  const shader = Shader.from({
    gl: { vertex: TERRAIN_VERTEX, fragment: TERRAIN_FRAGMENT },
    resources: {
      uHeight: heightTexture.texture.source,
      uHeightSampler: heightTexture.texture.source.style,
      uWaterLevel: waterTexture.texture.source,
      uWaterLevelSampler: waterTexture.texture.source.style,
      uFlowAcc: flowTexture.texture.source,
      uFlowAccSampler: flowTexture.texture.source.style,
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
    riverThreshold: number,
  ): void => {
    const previousWater = waterTexture;
    const previousFlow = flowTexture;
    waterTexture = createWorldTexture(size, waterLevel);
    flowTexture = createWorldTexture(size, flowAcc);
    shader.resources.uWaterLevel = waterTexture.texture.source;
    shader.resources.uWaterLevelSampler = waterTexture.texture.source.style;
    shader.resources.uFlowAcc = flowTexture.texture.source;
    shader.resources.uFlowAccSampler = flowTexture.texture.source.style;
    uniforms.uniforms.uHasWater = 1;
    uniforms.uniforms.uRiverThreshold = riverThreshold;
    uniforms.update();
    previousWater.destroy();
    previousFlow.destroy();
  };

  return {
    app,
    setHeight,
    setViewport,
    setView,
    setWater,
    screenSize,
    destroy: () => {
      app.renderer.off('resize', resizeMesh);
      heightTexture.destroy();
      waterTexture.destroy();
      flowTexture.destroy();
      app.destroy(true, { children: true });
    },
  };
}

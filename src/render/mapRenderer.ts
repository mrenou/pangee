/**
 * Moteur de rendu de la carte.
 *
 * Affiche, ne décide de rien : il reçoit un instantané du monde et le dessine.
 * Voir docs/rendu.md.
 */

import {
  Application,
  Geometry,
  Graphics,
  Matrix,
  Mesh,
  RenderTexture,
  Shader,
  UniformGroup,
  type WebGLRenderer,
} from 'pixi.js';
import { ringOffsetsDeg, worldToLocalLon } from '@/model/time';
import {
  normalizeViewport,
  screenToWorld,
  viewportForRect,
  visibleSpanDeg,
  worldToScreen,
  type Viewport,
  type WorldRect,
} from '@/model/viewport';
import { columnOfLon, rowOfLat } from '@/model/coords';
import { MAX_RINGS, type RingConfig, type RingId } from '@/model/ring';
import type { RasterSize } from '@/model/world';
import type { RiverNetwork } from '@/hydro/rivers';
import type { Creature, Place, Road } from '@/model/world';
import type { Point } from '@/edit/roads';
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX } from '@/render/terrainShader';
import { biomePaletteArray } from '@/render/palette';
import { createFogLayer, type FogMode } from '@/render/fogLayer';
import { drawDecorations, type ExportDecorations } from '@/render/exportDecorations';
import { ornamentScale, planExport, terraIncognitaSpot } from '@/render/exportPlan';
import { createLabelLayer } from '@/render/labelLayer';
import { createRiverLayer } from '@/render/riverLayer';
import { createRoadLayer } from '@/render/roadLayer';
import { createVolcanoLayer } from '@/render/volcanoLayer';
import { createCreatureLayer } from '@/render/creatureLayer';
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

export interface ExportRequest {
  readonly rect: WorldRect;
  readonly widthPx: number;
  /** Remplacer l'inconnu par du parchemin vierge. */
  readonly applyFog: boolean;
  readonly showFaults: boolean;
  readonly decorations: ExportDecorations;
  readonly radiusKm: number;
  /** Le brouillard tel que le store le connaît, pour placer « Terra incognita ». */
  readonly fog: {
    readonly size: RasterSize;
    readonly data: Uint8Array;
    readonly ringConfig: RingConfig;
    readonly tDays: number;
  };
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
  /** Lieu ouvert dans l'inspecteur, cerclé sur la carte. */
  setSelectedPlace: (id: string | undefined) => void;
  /** Routes, en référentiel local. */
  setRoads: (roads: readonly Road[]) => void;
  /** Route ouverte dans l'inspecteur, soulignée sur la carte. */
  setSelectedRoad: (id: string | undefined) => void;
  /** Tracé en cours, pas encore validé. */
  setDraftRoad: (points: readonly Point[]) => void;
  /** Créatures décoratives, en référentiel local de leur anneau. */
  setCreatures: (creatures: readonly Creature[]) => void;
  /** Trajectoires visibles et créature sélectionnée, sous l'outil créature. */
  setCreatureEditing: (editing: boolean, selectedId: string | undefined) => void;
  setDraftCreature: (points: readonly Point[], ringId: RingId | undefined) => void;
  /**
   * Renvoie au GPU la zone du relief modifiée par un coup de pinceau.
   * `undefined` réuploade toute la couche.
   */
  refreshHeight: (region?: SubImageRegion) => void;
  /** Réuploade la couche d'override de biome. */
  refreshBiomeOverride: (data: Uint8Array) => void;
  /** Brouillard de guerre, en référentiel local, à sa propre résolution. */
  setFog: (size: RasterSize, fog: Uint8Array) => void;
  /** Renvoie au GPU le brouillard modifié en place par le pinceau. */
  refreshFog: () => void;
  setFogMode: (mode: FogMode) => void;
  /**
   * Lance ou arrête l'horloge des animations : eau, volcans, créatures. Coupée,
   * la carte est exactement celle d'une image fixe.
   */
  setAnimated: (animated: boolean) => void;
  /** Cadre d'export en cours, tracé en pointillés sur la carte. */
  setExportRect: (rect: WorldRect | undefined) => void;
  /** Taille de texture maximale du GPU, pour planifier un export. */
  maxTextureSize: () => number;
  /**
   * Rend le cadre hors écran, à l'échelle de l'export et non de l'écran, puis
   * le décore. Lève une erreur lisible si l'export est trop grand.
   */
  exportPng: (request: ExportRequest) => Promise<Blob>;
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

/** Cadence des animations décoratives. */
const ANIMATION_MAX_FPS = 30;

export async function createMapRenderer(host: HTMLElement): Promise<MapRenderer> {
  const app = new Application();
  await app.init({
    background: PARCHMENT_BACKGROUND,
    resizeTo: host,
    antialias: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
    // Rendu à la demande : la boucle de Pixi ne tourne que pendant les
    // animations. Une carte immobile ne coûte rien, et le rendu logiciel de
    // WebGL — sans carte graphique — n'est pas saturé.
    autoStart: false,
  });
  host.appendChild(app.canvas);

  const uniforms = new UniformGroup({
    uCenter: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
    uViewSpanDeg: { value: new Float32Array([360, 180]), type: 'vec2<f32>' },
    uRingOffsetDeg: { value: new Float32Array(MAX_RINGS), type: 'f32', size: MAX_RINGS },
    uWaterRingOffsetDeg: { value: new Float32Array(MAX_RINGS), type: 'f32', size: MAX_RINGS },
    uCutLat: { value: new Float32Array(MAX_RINGS - 1), type: 'f32', size: MAX_RINGS - 1 },
    uCutCount: { value: 0, type: 'f32' },
    uRasterSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    uSeaLevelM: { value: 0, type: 'f32' },
    uMaxAltitudeM: { value: 6000, type: 'f32' },
    uMaxDepthM: { value: 8000, type: 'f32' },
    uShowFaults: { value: 1, type: 'f32' },
    uHasWater: { value: 0, type: 'f32' },
    uRiverThreshold: { value: 1e9, type: 'f32' },
    uStyle: { value: 1, type: 'f32' },
    uTimeS: { value: 0, type: 'f32' },
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

  // Les panaches montent au-dessus des icônes, sous le brouillard : à l'export,
  // un volcan inconnu ne doit pas se trahir par sa fumée.
  const volcanoLayer = createVolcanoLayer();
  app.stage.addChild(volcanoLayer.container);

  // Les créatures volent au-dessus de la carte, mais sous le brouillard.
  const creatureLayer = createCreatureLayer();
  app.stage.addChild(creatureLayer.container);
  let creatureEditing = false;
  let creatureDraft: { points: readonly Point[]; ringId: RingId | undefined } = {
    points: [],
    ringId: undefined,
  };

  // Le brouillard recouvre tout, libellés compris : à l'export, rien de ce qui
  // est caché ne doit transparaître.
  const fogLayer = createFogLayer(uniforms, geometry);
  app.stage.addChild(fogLayer.mesh);

  // Le cadre d'export est un repère pour le MJ, jamais dessiné dans l'image.
  const exportFrame = new Graphics();
  app.stage.addChild(exportFrame);
  let exportRect: WorldRect | undefined;
  let fogMode: FogMode = 'off';
  let selectedPlace: string | undefined;
  let selectedRoad: string | undefined;
  let draftRoad: readonly Point[] = [];

  /**
   * Textures remplacées, en attente de libération.
   *
   * Détruire une source encore liée au shader laisse le groupe de liaison
   * invalide : PixiJS le signale, et selon le pilote le terrain cesse d'être
   * dessiné. On attend donc le rendu suivant, qui reconstruit la liaison sur
   * les nouvelles sources, avant de libérer les anciennes.
   */
  const retired: HeightTexture[] = [];

  /**
   * Demande un rendu à l'image suivante.
   *
   * Rien ne redessine la carte de lui-même : tout changement visible doit
   * passer par ici. Plusieurs demandes dans la même image n'en font qu'une —
   * un glissé de caméra rend au rythme de l'écran, pas des événements souris.
   */
  let frameRequest: number | undefined;
  let destroyed = false;
  const renderNow = (): void => {
    frameRequest = undefined;
    if (destroyed) return;
    app.renderer.render(app.stage);
    while (retired.length > 0) retired.pop()?.destroy();
    fogLayer.releaseRetired();
  };
  const invalidate = (): void => {
    frameRequest ??= requestAnimationFrame(renderNow);
  };

  const resizeMesh = (): void => {
    mesh.scale.set(app.screen.width, app.screen.height);
    fogLayer.resize(app.screen.width, app.screen.height);
    invalidate();
  };
  resizeMesh();
  app.renderer.on('resize', resizeMesh);

  /** Dernière configuration reçue, pour dater les couches d'eau. */
  let lastRingConfig: RingConfig | undefined;

  const screenSize = (): { widthPx: number; heightPx: number } => ({
    widthPx: app.screen.width,
    heightPx: app.screen.height,
  });

  let screenViewport: Viewport | undefined;

  // Horloge d'animation. Pendant une animation, la boucle de Pixi rend chaque
  // image : animer revient à faire avancer quelques uniformes avant le rendu,
  // rien n'est reconstruit.
  let animationTimeS = 0;
  const tick = (): void => {
    animationTimeS += app.ticker.deltaMS / 1000;
    uniforms.uniforms.uTimeS = animationTimeS;
    uniforms.update();
    riverLayer.setAnimationTime(animationTimeS);
    volcanoLayer.setAnimationTime(animationTimeS);
    creatureLayer.setAnimationTime(animationTimeS);
  };
  let animated = false;
  const setAnimated = (next: boolean): void => {
    if (next === animated) return;
    animated = next;
    if (next) {
      app.ticker.add(tick);
      // Houle, fumée et vols sont lents : trente images par seconde suffisent,
      // pour moitié moins de calcul qu'au rythme de l'écran.
      app.ticker.maxFPS = ANIMATION_MAX_FPS;
      app.start();
      return;
    }
    app.stop();
    app.ticker.remove(tick);
    animationTimeS = 0;
    uniforms.uniforms.uTimeS = 0;
    uniforms.update();
    riverLayer.setAnimationTime(undefined);
    volcanoLayer.setAnimationTime(undefined);
    creatureLayer.setAnimationTime(undefined);
    invalidate();
  };

  const drawExportFrame = (): void => {
    exportFrame.clear();
    if (!exportRect || !screenViewport) return;
    const v = screenViewport;
    const corner = worldToScreen(v, { lon: exportRect.lonWestWorld, lat: exportRect.latNorth });
    const w = exportRect.widthDeg * v.pixelsPerDegree;
    const h = exportRect.heightDeg * v.pixelsPerDegree;
    exportFrame
      .rect(corner.x, corner.y, w, h)
      .fill({ color: 0x8a2b1a, alpha: 0.06 })
      .stroke({ width: 2, color: 0x8a2b1a, alpha: 0.9 });
  };

  /** Pousse un viewport à toutes les couches, sans le borner ni redessiner. */
  const applyViewport = (v: Viewport): void => {
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
    volcanoLayer.setViewport(v);
    creatureLayer.setViewport(v);
  };

  const setViewport = (viewport: Viewport): void => {
    const v = normalizeViewport(viewport);
    screenViewport = v;
    applyViewport(v);
    drawExportFrame();
    invalidate();
  };

  /** Lecture du brouillard au plus proche, pour la mention « Terra incognita ». */
  const revealedSampler =
    (v: Viewport, fog: ExportRequest['fog']) =>
    (xPx: number, yPx: number): number => {
      const world = screenToWorld(v, { x: xPx, y: yPx });
      const lonLocal = worldToLocalLon(world.lon, world.lat, fog.ringConfig, fog.tDays);
      const x = columnOfLon(lonLocal, fog.size.width);
      const y = rowOfLat(world.lat, fog.size.height);
      return (fog.data[y * fog.size.width + x] ?? 0) / 255;
    };

  const maxTextureSize = (): number => {
    const gl = (app.renderer as WebGLRenderer).gl as WebGL2RenderingContext | undefined;
    return gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096;
  };

  const exportPng = async (request: ExportRequest): Promise<Blob> => {
    const plan = planExport(request.rect, request.widthPx, maxTextureSize());
    if (!plan.ok) throw new Error(plan.error);
    const { widthPx, heightPx } = plan.value;
    // `v` couvre l'image pixel pour pixel ; `logical` est la même vue sur une
    // largeur réduite, que la transformation du rendu agrandit ensuite : les
    // ornements dessinés en pixels grandissent avec l'image.
    const v = viewportForRect(request.rect, widthPx);
    const k = ornamentScale(widthPx);
    const logical: Viewport = {
      ...v,
      pixelsPerDegree: v.pixelsPerDegree / k,
      widthPx: widthPx / k,
      heightPx: heightPx / k,
    };

    // On rend la scène telle quelle, à une autre échelle : tout ce qui n'est
    // qu'un repère d'édition doit d'abord disparaître.
    const showFaults = uniforms.uniforms.uShowFaults;
    exportFrame.visible = false;
    labelLayer.setSelected(undefined);
    roadLayer.setSelected(undefined);
    roadLayer.setDraft([]);
    creatureLayer.setEditing(false);
    creatureLayer.setDraft([], undefined);
    fogLayer.setMode(request.applyFog ? 'export' : 'off');
    uniforms.uniforms.uShowFaults = request.showFaults ? 1 : 0;
    uniforms.update();
    mesh.scale.set(logical.widthPx, logical.heightPx);
    fogLayer.resize(logical.widthPx, logical.heightPx);
    // Une grille de symboles à l'espacement écran, sur toute l'image.
    symbolLayer.setExportBudget(Math.ceil(((logical.widthPx * logical.heightPx) / 26 / 26) * 1.5));
    labelLayer.setTextResolution(k);
    applyViewport(logical);

    const target = RenderTexture.create({ width: widthPx, height: heightPx, resolution: 1 });
    try {
      app.renderer.render({ container: app.stage, target, transform: new Matrix().scale(k, k) });
      const extracted = app.renderer.extract.canvas({ target }) as HTMLCanvasElement;

      const canvas = document.createElement('canvas');
      canvas.width = widthPx;
      canvas.height = heightPx;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Le navigateur refuse de créer un canvas 2D pour l’export.');
      ctx.drawImage(extracted, 0, 0);

      const spot = request.applyFog
        ? terraIncognitaSpot(
            widthPx,
            heightPx,
            revealedSampler(v, request.fog),
            Math.min(widthPx, heightPx) / 6,
          )
        : undefined;
      drawDecorations(ctx, plan.value, request.rect, request.radiusKm, request.decorations, spot);

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) =>
          blob ? resolve(blob) : reject(new Error('La conversion en PNG a échoué.')),
        );
      });
    } finally {
      target.destroy(true);
      symbolLayer.setExportBudget(undefined);
      labelLayer.setTextResolution(1);
      uniforms.uniforms.uShowFaults = showFaults;
      uniforms.update();
      fogLayer.setMode(fogMode);
      labelLayer.setSelected(selectedPlace);
      roadLayer.setSelected(selectedRoad);
      roadLayer.setDraft(draftRoad);
      creatureLayer.setEditing(creatureEditing);
      creatureLayer.setDraft(creatureDraft.points, creatureDraft.ringId);
      exportFrame.visible = true;
      resizeMesh();
      if (screenViewport) applyViewport(screenViewport);
      invalidate();
    }
  };

  const setView = (view: TerrainView): void => {
    lastRingConfig = view.ringConfig;
    const offsets = ringOffsetsDeg(view.ringConfig, view.tDays);
    const ringOffset = uniforms.uniforms.uRingOffsetDeg as Float32Array;
    const cut = uniforms.uniforms.uCutLat as Float32Array;
    ringOffset.fill(0);
    ringOffset.set(offsets.slice(0, MAX_RINGS));
    cut.fill(0);
    cut.set(view.ringConfig.cutsLat.slice(0, MAX_RINGS - 1));
    uniforms.uniforms.uCutCount = Math.min(view.ringConfig.cutsLat.length, MAX_RINGS - 1);
    uniforms.uniforms.uSeaLevelM = view.seaLevelM;
    uniforms.uniforms.uMaxAltitudeM = view.maxAltitudeM;
    uniforms.uniforms.uMaxDepthM = view.maxDepthM;
    uniforms.uniforms.uShowFaults = view.showFaults ? 1 : 0;
    uniforms.uniforms.uStyle = view.bookStyle ? 1 : 0;
    symbolLayer.setVisible(view.bookStyle);
    labelLayer.setTime(view.ringConfig, view.tDays);
    volcanoLayer.setTime(view.ringConfig, view.tDays);
    creatureLayer.setTime(view.ringConfig, view.tDays);
    roadLayer.setTime(view.ringConfig, view.tDays);
    symbolLayer.setTime(view.ringConfig, view.tDays);
    riverLayer.setTime(view.ringConfig, view.tDays);
    uniforms.update();
    invalidate();
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
      waterOffset.fill(0);
      waterOffset.set(at.slice(0, MAX_RINGS));
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
    setPlaces: (next) => {
      labelLayer.setPlaces(next);
      volcanoLayer.setPlaces(next);
      invalidate();
    },
    setSelectedPlace: (id) => {
      selectedPlace = id;
      labelLayer.setSelected(id);
      invalidate();
    },
    setRoads: (next) => {
      roadLayer.setRoads(next);
      invalidate();
    },
    setDraftRoad: (next) => {
      draftRoad = next;
      roadLayer.setDraft(next);
      invalidate();
    },
    setCreatures: (next) => {
      creatureLayer.setCreatures(next);
      invalidate();
    },
    setCreatureEditing: (editing, selectedId) => {
      creatureEditing = editing;
      creatureLayer.setEditing(editing);
      creatureLayer.setSelected(selectedId);
      invalidate();
    },
    setDraftCreature: (points, ringId) => {
      creatureDraft = { points, ringId };
      creatureLayer.setDraft(points, ringId);
      invalidate();
    },
    setSelectedRoad: (id) => {
      selectedRoad = id;
      roadLayer.setSelected(id);
      invalidate();
    },

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
    setFog: (size, fog) => {
      fogLayer.setFog(size, fog);
      invalidate();
    },
    refreshFog: () => {
      fogLayer.refresh();
      invalidate();
    },
    setFogMode: (mode) => {
      fogMode = mode;
      fogLayer.setMode(mode);
      invalidate();
    },
    setExportRect: (rect) => {
      exportRect = rect;
      drawExportFrame();
      invalidate();
    },
    maxTextureSize,
    exportPng,
    setAnimated,
    screenSize,
    destroy: () => {
      destroyed = true;
      if (frameRequest !== undefined) cancelAnimationFrame(frameRequest);
      app.ticker.remove(tick);
      app.renderer.off('resize', resizeMesh);
      riverLayer.destroy();
      roadLayer.destroy();
      symbolLayer.destroy();
      labelLayer.destroy();
      volcanoLayer.destroy();
      creatureLayer.destroy();

      // L'application d'abord, les textures ensuite : les libérer tant que le
      // shader les référence encore laisse un groupe de liaison invalide, et
      // PixiJS le signale à chaque démontage.
      app.destroy(true, { children: true });
      for (const texture of [heightTexture, waterTexture, flowTexture, biomeTexture, ...retired]) {
        texture.destroy();
      }
      retired.length = 0;
      fogLayer.destroy();
    },
  };
}

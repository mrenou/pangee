import { useEffect, useRef } from 'react';
import { MAX_ALTITUDE, MAX_DEPTH, useWorldStore } from '@/store/worldStore';
import { useViewportStore } from '@/store/viewportStore';
import { RAIN_PER_CELL, useHydroStore } from '@/store/hydroStore';
import { attachEditControls } from '@/edit/editControls';
import { editTarget, useEditStore } from '@/store/editStore';
import { attachCameraControls } from '@/render/cameraControls';
import { createMapRenderer, type MapRenderer } from '@/render/mapRenderer';

/** Transmet au moteur les réglages qui gouvernent l'apparence de la carte. */
function pushView(renderer: MapRenderer): void {
  const { ringConfig, tDays, seaLevelM, showFaults, bookStyle } = useWorldStore.getState();
  renderer.setView({
    ringConfig,
    tDays,
    seaLevelM,
    showFaults,
    bookStyle,
    maxAltitudeM: MAX_ALTITUDE,
    maxDepthM: MAX_DEPTH,
  });
}

/**
 * Transmet au moteur l'intégralité de l'état courant.
 *
 * Le moteur naît après le premier rendu de React, et en développement le
 * composant est monté deux fois : les effets qui lui poussent l'état ont donc
 * déjà tourné dans le vide, et rien ne les rejoue si leurs dépendances ne
 * changent plus. Oublier une couche ici, c'est la voir manquer pour de bon —
 * le relief manquait, et la carte restait un aplat de parchemin.
 */
function pushAll(renderer: MapRenderer): void {
  const world = useWorldStore.getState();

  pushView(renderer);
  renderer.setViewport(useViewportStore.getState().viewport);
  renderer.setPlaces(world.places);
  const { tool, selectedPlaceId } = useEditStore.getState();
  renderer.setSelectedPlace(tool === 'place' ? selectedPlaceId : undefined);
  renderer.setRoads(world.roads);

  if (world.height) renderer.setHeight(world.rasterSize, world.height);

  const { water } = useHydroStore.getState();
  if (water) {
    renderer.setTerrainSample({
      size: water.size,
      heightWorld: water.heightWorld,
      biome: water.biome,
      waterLevel: water.waterLevel,
      seaLevelM: world.seaLevelM,
      tDays: water.tDays,
    });
    renderer.setWater(
      water.size,
      water.waterLevel,
      water.flowAcc,
      water.biome,
      water.rivers,
      water.riverThreshold,
      water.tDays,
    );
  }
}

/**
 * Hôte React du canvas Pixi. Monte le moteur de rendu, lui pousse l'état du
 * store, et rien d'autre. Voir docs/rendu.md.
 */
export function MapCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: MapRenderer | undefined;
    let controls: { destroy: () => void } | undefined;
    let edits: { destroy: () => void } | undefined;
    let observer: ResizeObserver | undefined;
    let cancelled = false;

    void createMapRenderer(host).then((created) => {
      if (cancelled) {
        created.destroy();
        return;
      }
      renderer = created;
      rendererRef.current = created;

      const { setViewport } = useViewportStore.getState();
      controls = attachCameraControls(
        created.app.canvas,
        () => useViewportStore.getState().viewport,
        setViewport,
        // Un outil actif prend la main sur le déplacement de la carte.
        () => useEditStore.getState().tool === 'pan',
      );

      edits = attachEditControls(created.app.canvas, {
        getTool: () => useEditStore.getState().tool,
        getViewport: () => useViewportStore.getState().viewport,
        getRingConfig: () => useWorldStore.getState().ringConfig,
        getTDays: () => useWorldStore.getState().tDays,
        getTarget: editTarget,
        getRelief: () => useEditStore.getState().relief,
        getBiomeShape: () => useEditStore.getState().biomeShape,
        getBiomeValue: () => useEditStore.getState().biomeValue,
        getRoadFollowsTerrain: () => useEditStore.getState().roadFollowsTerrain,
        getSeaLevelM: () => useWorldStore.getState().seaLevelM,
        getRadiusKm: () => useWorldStore.getState().radiusKm,
        onRasterTouched: (layer) => {
          // Le terrain doit suivre le pinceau sans attendre : on réuploade au
          // fil du geste, l'hydrologie ne sera recalculée qu'à la fin.
          if (layer === 'height') created.refreshHeight();
        },
        onCommand: (command) => {
          useEditStore.getState().record(command);
          // Un lieu ou une route ne justifie ni un réupload du relief ni un
          // recalcul de l'eau.
          if (command.kind === 'raster') useWorldStore.getState().bumpHeightVersion();
          useWorldStore.getState().scheduleAutosave();
        },
        onDraftRoad: (points) => created.setDraftRoad(points),
        onSelectPlace: (id) => useEditStore.getState().selectPlace(id),
        onDeleteSelection: () => useEditStore.getState().deleteSelectedPlace(),
      });

      const syncSize = (): void => {
        const { widthPx, heightPx } = created.screenSize();
        useViewportStore.getState().resize(widthPx, heightPx);
      };
      observer = new ResizeObserver(syncSize);
      observer.observe(host);
      syncSize();

      // Le moteur naît après le premier rendu de React : les effets qui lui
      // poussent l'état ont donc déjà tourné dans le vide, et rien ne les
      // rejouera si leurs dépendances ne changent pas. On lui transmet l'état
      // courant une fois, ici.
      pushAll(created);

      // On reprend le monde laissé par la session précédente ; à défaut, on en
      // façonne un neuf. La carte ne doit jamais s'ouvrir sur du vide.
      void useWorldStore
        .getState()
        .restoreFromStorage()
        .then((restored) => {
          if (!restored && !cancelled) void useWorldStore.getState().regenerate();
        });
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      edits?.destroy();
      controls?.destroy();
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Le relief change rarement : on ne re-téléverse que sur changement de version.
  const heightVersion = useWorldStore((s) => s.heightVersion);
  useEffect(() => {
    const { height, rasterSize } = useWorldStore.getState();
    if (height) rendererRef.current?.setHeight(rasterSize, height);
  }, [heightVersion]);

  const places = useWorldStore((s) => s.places);
  useEffect(() => {
    rendererRef.current?.setPlaces(places);
  }, [places]);

  // Le cercle de sélection n'a de sens que sous l'outil qui permet de retoucher.
  const tool = useEditStore((s) => s.tool);
  const selectedPlaceId = useEditStore((s) => s.selectedPlaceId);
  useEffect(() => {
    rendererRef.current?.setSelectedPlace(tool === 'place' ? selectedPlaceId : undefined);
  }, [tool, selectedPlaceId]);

  const roads = useWorldStore((s) => s.roads);
  useEffect(() => {
    rendererRef.current?.setRoads(roads);
  }, [roads]);

  const viewport = useViewportStore((s) => s.viewport);
  useEffect(() => {
    rendererRef.current?.setViewport(viewport);
  }, [viewport]);

  const ringConfig = useWorldStore((s) => s.ringConfig);
  const tDays = useWorldStore((s) => s.tDays);
  const seaLevelM = useWorldStore((s) => s.seaLevelM);
  const showFaults = useWorldStore((s) => s.showFaults);
  const bookStyle = useWorldStore((s) => s.bookStyle);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer) pushView(renderer);
  }, [ringConfig, tDays, seaLevelM, showFaults, bookStyle]);

  // Le worker garde sa propre copie des couches locales : elle lui est renvoyée
  // à chaque nouveau monde et à la fin de chaque édition raster, jamais au
  // fil du pinceau. Cet effet doit précéder celui qui programme le calcul :
  // les messages au worker sont traités dans l'ordre d'envoi.
  useEffect(() => {
    if (heightVersion === 0) return;
    const { rasterSize, height, biomeOverride } = useWorldStore.getState();
    if (height && biomeOverride) {
      void useHydroStore.getState().setLayers(rasterSize, height, biomeOverride);
    }
  }, [heightVersion]);

  // L'eau est recalculée après coup : le terrain a déjà glissé, seul un
  // uniforme ayant changé. Voir docs/temps.md.
  useEffect(() => {
    if (heightVersion === 0) return;
    useHydroStore.getState().schedule({
      ringConfig,
      tDays,
      seaLevelM,
      rainPerCell: RAIN_PER_CELL,
      seed: useWorldStore.getState().terrain.seed,
    });
  }, [heightVersion, ringConfig, tDays, seaLevelM]);

  const waterVersion = useHydroStore((s) => s.waterVersion);
  useEffect(() => {
    const { water } = useHydroStore.getState();
    if (water) {
      rendererRef.current?.setTerrainSample({
        size: water.size,
        heightWorld: water.heightWorld,
        biome: water.biome,
        waterLevel: water.waterLevel,
        seaLevelM: useWorldStore.getState().seaLevelM,
        tDays: water.tDays,
      });
      rendererRef.current?.setWater(
        water.size,
        water.waterLevel,
        water.flowAcc,
        water.biome,
        water.rivers,
        water.riverThreshold,
        water.tDays,
      );
    }
  }, [waterVersion]);

  return <div ref={hostRef} className="relative h-full flex-1 cursor-grab bg-parchment-dark" />;
}

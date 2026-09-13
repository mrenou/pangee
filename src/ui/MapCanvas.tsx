import { useEffect, useRef } from 'react';
import { MAX_ALTITUDE, MAX_DEPTH, useWorldStore } from '@/store/worldStore';
import { useViewportStore } from '@/store/viewportStore';
import { attachCameraControls } from '@/render/cameraControls';
import { createMapRenderer, type MapRenderer } from '@/render/mapRenderer';

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
      );

      const syncSize = (): void => {
        const { widthPx, heightPx } = created.screenSize();
        useViewportStore.getState().resize(widthPx, heightPx);
      };
      observer = new ResizeObserver(syncSize);
      observer.observe(host);
      syncSize();

      // Premier monde : la carte ne doit jamais s'ouvrir sur du vide.
      void useWorldStore.getState().regenerate();
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
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

  const viewport = useViewportStore((s) => s.viewport);
  useEffect(() => {
    rendererRef.current?.setViewport(viewport);
  }, [viewport]);

  const ringConfig = useWorldStore((s) => s.ringConfig);
  const tDays = useWorldStore((s) => s.tDays);
  const seaLevelM = useWorldStore((s) => s.seaLevelM);
  const showFaults = useWorldStore((s) => s.showFaults);
  useEffect(() => {
    rendererRef.current?.setView({
      ringConfig,
      tDays,
      seaLevelM,
      showFaults,
      maxAltitudeM: MAX_ALTITUDE,
      maxDepthM: MAX_DEPTH,
    });
  }, [ringConfig, tDays, seaLevelM, showFaults]);

  return <div ref={hostRef} className="relative h-full flex-1 cursor-grab bg-parchment-dark" />;
}

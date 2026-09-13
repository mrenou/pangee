import { useEffect, useRef } from 'react';
import { createMapRenderer, type MapRenderer } from '@/render/mapRenderer';

/**
 * Hôte React du canvas Pixi. Ce composant ne connaît rien du monde : il monte
 * le moteur de rendu et le démonte. Voir docs/rendu.md.
 */
export function MapCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: MapRenderer | undefined;
    let cancelled = false;

    void createMapRenderer(host).then((created) => {
      if (cancelled) {
        created.destroy();
        return;
      }
      renderer = created;
    });

    return () => {
      cancelled = true;
      renderer?.destroy();
    };
  }, []);

  return <div ref={hostRef} className="relative h-full flex-1 bg-parchment-dark" />;
}

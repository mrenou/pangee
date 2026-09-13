import { Application, Container, Graphics } from 'pixi.js';

/**
 * Moteur de rendu de la carte. Squelette de la phase 0b : il monte
 * l'application Pixi et dessine un repère provisoire. Le shader terrain et la
 * caméra arrivent en phase 1. Voir docs/rendu.md.
 */
export interface MapRenderer {
  readonly app: Application;
  destroy: () => void;
}

export async function createMapRenderer(host: HTMLElement): Promise<MapRenderer> {
  const app = new Application();
  await app.init({
    background: 0xd4c4a0,
    resizeTo: host,
    antialias: true,
    preference: 'webgl',
  });

  host.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);

  // Repère provisoire : les deux latitudes de coupure, en attendant le terrain.
  const guides = new Graphics();
  world.addChild(guides);

  const drawGuides = (): void => {
    const { width, height } = app.screen;
    guides.clear();
    for (const fraction of [1 / 3, 2 / 3]) {
      guides.moveTo(0, height * fraction).lineTo(width, height * fraction);
    }
    guides.stroke({ width: 2, color: 0x5a4a38, alpha: 0.5 });
  };

  drawGuides();
  app.renderer.on('resize', drawGuides);

  return {
    app,
    destroy: () => {
      app.renderer.off('resize', drawGuides);
      app.destroy(true, { children: true });
    },
  };
}

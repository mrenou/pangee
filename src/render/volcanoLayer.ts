/**
 * Volcans : une lueur qui palpite et un panache de fumée qui monte.
 *
 * Purement décoratif, et piloté par l'horloge d'animation. Les volcans sont
 * des lieux comme les autres (`kind === 'volcano'`), en référentiel local :
 * le panache suit son anneau. Redessiner quelques volcans par image coûte
 * peu ; quand aucun n'est à l'écran, rien n'est tracé. Voir docs/rendu.md.
 */

import { Container, Graphics } from 'pixi.js';
import type { RingConfig } from '@/model/ring';
import { localToWorldLon } from '@/model/time';
import { worldToScreen, type Viewport } from '@/model/viewport';
import type { Place } from '@/model/world';

/** Bouffées simultanées par panache. */
const PUFFS = 6;
/** Hauteur atteinte par une bouffée avant de se dissiper, en pixels. */
const RISE_PX = 34;
/** Durée de vie d'une bouffée, en secondes. */
const PUFF_LIFE_S = 4.5;

export interface VolcanoLayer {
  readonly container: Container;
  setPlaces: (places: readonly Place[]) => void;
  setTime: (ringConfig: RingConfig, tDays: number) => void;
  setViewport: (viewport: Viewport) => void;
  /** `undefined` éteint les volcans : la carte redevient une image fixe. */
  setAnimationTime: (timeS: number | undefined) => void;
  destroy: () => void;
}

/** Phase propre à chaque volcan, pour qu'ils ne fument pas en cadence. */
function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function createVolcanoLayer(): VolcanoLayer {
  const container = new Container();
  const graphics = new Graphics();
  container.addChild(graphics);

  let volcanoes: readonly { readonly place: Place; readonly phase: number }[] = [];
  let ringConfig: RingConfig | undefined;
  let tDays = 0;
  let viewport: Viewport | undefined;
  let timeS: number | undefined;

  const draw = (): void => {
    graphics.clear();
    if (timeS === undefined || !viewport || !ringConfig || volcanoes.length === 0) return;
    const t = timeS;

    for (const { place, phase } of volcanoes) {
      const lonWorld = localToWorldLon(place.lon, place.lat, ringConfig, tDays);
      const p = worldToScreen(viewport, { lon: lonWorld, lat: place.lat });
      if (p.x < -60 || p.y < -60 || p.x > viewport.widthPx + 60 || p.y > viewport.heightPx + 60) {
        continue;
      }

      // Lueur du cratère, qui respire.
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.1 + phase * 6.28);
      graphics
        .circle(p.x, p.y, 7 + pulse * 3)
        .fill({ color: 0xd9622b, alpha: 0.18 + pulse * 0.12 });
      graphics.circle(p.x, p.y, 3).fill({ color: 0xf2a541, alpha: 0.35 + pulse * 0.25 });

      // Panache : des bouffées qui montent, grossissent, dérivent vers l'est et
      // s'effacent.
      for (let k = 0; k < PUFFS; k += 1) {
        const age = (t / PUFF_LIFE_S + k / PUFFS + phase) % 1;
        const x = p.x + age * 12 + Math.sin(age * 5 + phase * 9) * 3;
        const y = p.y - 5 - age * RISE_PX;
        const radius = 2.5 + age * 7;
        const alpha = Math.min(1, age * 6) * (1 - age) * 0.55;
        graphics.circle(x, y, radius).fill({ color: 0x6e6259, alpha });
      }
    }
  };

  return {
    container,
    setPlaces: (places) => {
      volcanoes = places
        .filter((place) => place.kind === 'volcano')
        .map((place) => ({ place, phase: phaseOf(place.id) }));
      draw();
    },
    setTime: (config, days) => {
      ringConfig = config;
      tDays = days;
      draw();
    },
    setViewport: (next) => {
      viewport = next;
      draw();
    },
    setAnimationTime: (next) => {
      timeS = next;
      draw();
    },
    destroy: () => container.destroy({ children: true }),
  };
}

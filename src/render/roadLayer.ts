/**
 * Tracé des routes et du chemin en cours.
 *
 * Les routes sont stockées en référentiel local : chacune est convertie à la
 * date courante selon l'anneau qu'elle porte. C'est ce qui fait qu'une route
 * coupée par une faille s'écarte de sa moitié avec le temps.
 * Voir docs/rendu.md et docs/editeur.md.
 */

import { Container, Graphics } from 'pixi.js';
import type { Point } from '@/edit/roads';
import { wrapLon } from '@/model/coords';
import type { RingConfig } from '@/model/ring';
import { offsetAtLat, offsetOfRing } from '@/model/time';
import { worldToScreen, type Viewport } from '@/model/viewport';
import type { Road } from '@/model/world';

const ROAD_INK = 0x6b4f32;
const DRAFT_INK = 0x8a3f2a;
/** Même rouge que le cercle du lieu sélectionné. */
const SELECTED_INK = 0x8a2b1a;

const STYLE: Readonly<Record<Road['kind'], { width: number; dash: number }>> = {
  road: { width: 1.8, dash: 0 },
  path: { width: 1.2, dash: 5 },
  'sea-route': { width: 1.1, dash: 9 },
};

export interface RoadLayer {
  readonly container: Container;
  setRoads: (roads: readonly Road[]) => void;
  setDraft: (points: readonly Point[]) => void;
  setSelected: (id: string | undefined) => void;
  setTime: (ringConfig: RingConfig, tDays: number) => void;
  setViewport: (viewport: Viewport) => void;
  destroy: () => void;
}

export function createRoadLayer(): RoadLayer {
  const container = new Container();
  const graphics = new Graphics();
  container.addChild(graphics);

  let roads: readonly Road[] = [];
  let draft: readonly Point[] = [];
  let selectedId: string | undefined;
  let ringConfig: RingConfig | undefined;
  let tDays = 0;
  let viewport: Viewport | undefined;

  const draw = (): void => {
    graphics.clear();
    if (!viewport || !ringConfig) return;

    for (const road of roads) {
      const offset = offsetOfRing(road.ringId, road.points[0]?.[1] ?? 0, ringConfig, tDays);
      if (road.id === selectedId) {
        // Un liseré large sous le tracé : la route garde son style propre.
        strokePath(
          graphics,
          viewport,
          road.points.map(([lon, lat]) => [wrapLon(lon + offset), lat] as Point),
          { width: STYLE[road.kind].width + 4, dash: 0 },
          SELECTED_INK,
          0.45,
        );
      }
      strokePath(
        graphics,
        viewport,
        road.points.map(([lon, lat]) => [wrapLon(lon + offset), lat] as Point),
        STYLE[road.kind],
        ROAD_INK,
        0.8,
      );
    }

    if (draft.length >= 2 && ringConfig) {
      // Le brouillon n'est pas encore scindé : on l'affiche tel qu'il est
      // tracé, chaque point décalé selon l'anneau de sa propre latitude.
      const config = ringConfig;
      strokePath(
        graphics,
        viewport,
        draft.map(([lon, lat]) => {
          return [wrapLon(lon + offsetAtLat(lat, config, tDays)), lat] as Point;
        }),
        { width: 1.6, dash: 4 },
        DRAFT_INK,
        0.9,
      );
    }
  };

  return {
    container,
    setRoads: (next) => {
      roads = next;
      draw();
    },
    setDraft: (next) => {
      draft = next;
      draw();
    },
    setSelected: (id) => {
      selectedId = id;
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
    destroy: () => container.destroy({ children: true }),
  };
}

/**
 * Trace une polyligne en coordonnées monde, segment par segment.
 * Un segment dont les extrémités tombent de part et d'autre de l'écran vient
 * d'un franchissement du méridien : on le saute plutôt que de barrer la carte.
 */
function strokePath(
  graphics: Graphics,
  viewport: Viewport,
  points: readonly Point[],
  style: { width: number; dash: number },
  color: number,
  alpha: number,
): void {
  const screen = points.map(([lon, lat]) => worldToScreen(viewport, { lon, lat }));
  const maxJump = viewport.widthPx * 0.5;

  for (let i = 1; i < screen.length; i += 1) {
    const a = screen[i - 1]!;
    const b = screen[i]!;
    if (Math.abs(b.x - a.x) > maxJump) continue;

    if (style.dash <= 0) {
      graphics.moveTo(a.x, a.y).lineTo(b.x, b.y);
    } else {
      dashedSegment(graphics, a, b, style.dash);
    }
  }

  graphics.stroke({ width: style.width, color, alpha, cap: 'round', join: 'round' });
}

function dashedSegment(
  graphics: Graphics,
  a: { x: number; y: number },
  b: { x: number; y: number },
  dash: number,
): void {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= 0) return;

  const steps = Math.max(1, Math.floor(length / dash));
  const dx = (b.x - a.x) / steps;
  const dy = (b.y - a.y) / steps;

  for (let i = 0; i < steps; i += 2) {
    graphics.moveTo(a.x + dx * i, a.y + dy * i).lineTo(a.x + dx * (i + 1), a.y + dy * (i + 1));
  }
}

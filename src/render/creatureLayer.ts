/**
 * Créatures décoratives : dragons, navires, oiseaux, serpents de mer.
 *
 * Chacune parcourt sa trajectoire au rythme de l'horloge d'animation ; sans
 * animation, elle se tient immobile à son premier point, et la carte reste une
 * image fixe. Les silhouettes sont tracées à l'encre en pixels écran, comme
 * les icônes de lieux. Trajectoires et tracé en cours ne se montrent que sous
 * l'outil créature. Voir docs/rendu.md.
 */

import { Container, Graphics } from 'pixi.js';
import type { Point } from '@/edit/roads';
import { wrapLon } from '@/model/coords';
import type { RingConfig, RingId } from '@/model/ring';
import { ringOffsetDeg } from '@/model/time';
import { worldToScreen, type Viewport } from '@/model/viewport';
import type { Creature, CreatureKind } from '@/model/world';
import { creaturePose } from '@/render/creatureMotion';

const INK = 0x2b2118;
const DRAGON = 0x6b2a1e;
const SAIL = 0xf2e8d0;
const PATH_INK = 0x8a2b1a;
/** Les figures sont dessinées dans un repère d'une dizaine d'unités, agrandi ici. */
const FIGURE_SCALE = 1.8;

export interface CreatureLayer {
  readonly container: Container;
  setCreatures: (creatures: readonly Creature[]) => void;
  setTime: (ringConfig: RingConfig, tDays: number) => void;
  setViewport: (viewport: Viewport) => void;
  /** `undefined` fige les créatures à leur premier point. */
  setAnimationTime: (timeS: number | undefined) => void;
  /** Trajectoires visibles, sous l'outil créature. */
  setEditing: (editing: boolean) => void;
  setSelected: (id: string | undefined) => void;
  setDraft: (points: readonly Point[], ringId: RingId | undefined) => void;
  destroy: () => void;
}

/** Trace une figure définie dans un repère local tourné du cap. */
interface Pen {
  readonly g: Graphics;
  readonly x: number;
  readonly y: number;
  readonly cos: number;
  readonly sin: number;
  readonly scale: number;
}

/** Repère local → écran : x vers l'avant, y vers la gauche ; l'écran a y vers le bas. */
function at(pen: Pen, u: number, v: number): [number, number] {
  const su = u * pen.scale;
  const sv = v * pen.scale;
  return [pen.x + su * pen.cos - sv * pen.sin, pen.y - (su * pen.sin + sv * pen.cos)];
}

function polygon(pen: Pen, points: readonly (readonly [number, number])[]): Graphics {
  return pen.g.poly(points.flatMap(([u, v]) => at(pen, u, v)));
}

function drawDragon(pen: Pen, flap: number): void {
  // Ailes : le battement fait varier leur envergure.
  const span = 5 + 5 * flap;
  polygon(pen, [
    [2, 0],
    [-3, span],
    [-6, span * 0.4],
  ]).fill({ color: DRAGON, alpha: 0.9 });
  polygon(pen, [
    [2, 0],
    [-3, -span],
    [-6, -span * 0.4],
  ]).fill({ color: DRAGON, alpha: 0.9 });
  // Corps effilé, de la tête à la queue.
  polygon(pen, [
    [8, 0],
    [3, 1.8],
    [-6, 0.8],
    [-12, 0],
    [-6, -0.8],
    [3, -1.8],
  ])
    .fill({ color: DRAGON })
    .stroke({ width: 0.8, color: INK, alpha: 0.9 });
}

function drawShip(pen: Pen, bob: number): void {
  // Un navire reste debout : il ne fait que se retourner selon son cap.
  const facing = (pen.cos >= 0 ? 1 : -1) * pen.scale;
  const k = pen.scale;
  const g = pen.g;
  const x = pen.x;
  const y = pen.y + bob * k;
  g.poly([
    x - 7 * facing,
    y,
    x + 7 * facing,
    y,
    x + 5 * facing,
    y + 3.5 * k,
    x - 5 * facing,
    y + 3.5 * k,
  ]).fill({ color: INK, alpha: 0.85 });
  g.moveTo(x, y)
    .lineTo(x, y - 11 * k)
    .stroke({ width: k, color: INK });
  g.poly([x + 0.5 * facing, y - 10 * k, x + 6 * facing, y - 2 * k, x + 0.5 * facing, y - 2 * k])
    .fill({ color: SAIL })
    .stroke({ width: 0.8, color: INK });
}

function drawBirds(pen: Pen, flap: number): void {
  // Trois oiseaux en V, chacun un trait de plume.
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [-5, 4],
    [-5, -4],
  ];
  const lift = 1 + 2 * flap;
  for (const [du, dv] of offsets) {
    const [ax, ay] = at(pen, du - 1, dv + 3);
    const [bx, by] = at(pen, du, dv);
    const [cx, cy] = at(pen, du - 1, dv - 3);
    pen.g
      .moveTo(ax, ay - lift)
      .lineTo(bx, by)
      .lineTo(cx, cy - lift)
      .stroke({ width: 1.1, color: INK, alpha: 0.9, cap: 'round', join: 'round' });
  }
}

function drawSerpent(pen: Pen, timeS: number): void {
  // Des anneaux qui ondulent derrière la tête, comme sur les vieilles cartes.
  const path: [number, number][] = [];
  for (let k = 0; k <= 8; k += 1) {
    const u = -k * 2;
    const v = Math.sin(k * 0.9 - timeS * 4) * 2.2;
    path.push(at(pen, u, v));
  }
  const [first, ...rest] = path;
  if (!first) return;
  pen.g.moveTo(first[0], first[1]);
  for (const [x, y] of rest) pen.g.lineTo(x, y);
  pen.g.stroke({ width: 2.4, color: 0x3c5a4a, alpha: 0.9, cap: 'round', join: 'round' });
  const [hx, hy] = at(pen, 1.5, 0);
  pen.g.circle(hx, hy, 2).fill({ color: 0x3c5a4a });
}

const DRAW: Readonly<Record<CreatureKind, (pen: Pen, timeS: number) => void>> = {
  dragon: (pen, t) => drawDragon(pen, 0.5 + 0.5 * Math.sin(t * 7)),
  ship: (pen, t) => drawShip(pen, Math.sin(t * 2) * 0.8),
  bird: (pen, t) => drawBirds(pen, 0.5 + 0.5 * Math.sin(t * 9)),
  serpent: (pen, t) => drawSerpent(pen, t),
};

export function createCreatureLayer(): CreatureLayer {
  const container = new Container();
  const paths = new Graphics();
  const figures = new Graphics();
  container.addChild(paths, figures);

  let creatures: readonly Creature[] = [];
  let ringConfig: RingConfig | undefined;
  let tDays = 0;
  let viewport: Viewport | undefined;
  let timeS: number | undefined;
  let editing = false;
  let selectedId: string | undefined;
  let draft: readonly Point[] = [];
  let draftRing: RingId | undefined;

  const offsetOf = (ringId: RingId): number =>
    ringConfig ? ringOffsetDeg(ringConfig.rings[ringId], tDays, ringConfig.t0) : 0;

  const strokeTrajectory = (
    points: readonly Point[],
    ringId: RingId,
    closed: boolean,
    style: { width: number; alpha: number },
  ): void => {
    if (!viewport || points.length < 2) return;
    const offset = offsetOf(ringId);
    const screen = points.map(([lon, lat]) =>
      worldToScreen(viewport!, { lon: wrapLon(lon + offset), lat }),
    );
    if (closed) screen.push(screen[0]!);
    const maxJump = viewport.widthPx * 0.5;
    for (let i = 1; i < screen.length; i += 1) {
      const a = screen[i - 1]!;
      const b = screen[i]!;
      if (Math.abs(b.x - a.x) > maxJump) continue;
      // Pointillé : la trajectoire est un repère, pas un trait de la carte.
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.floor(length / 5));
      for (let s = 0; s < steps; s += 2) {
        paths
          .moveTo(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps)
          .lineTo(a.x + ((b.x - a.x) * (s + 1)) / steps, a.y + ((b.y - a.y) * (s + 1)) / steps);
      }
    }
    paths.stroke({ width: style.width, color: PATH_INK, alpha: style.alpha, cap: 'round' });
  };

  const drawPaths = (): void => {
    paths.clear();
    if (!viewport) return;
    if (editing) {
      for (const c of creatures) {
        const selected = c.id === selectedId;
        strokeTrajectory(c.points, c.ringId, c.loop, {
          width: selected ? 2.2 : 1.2,
          alpha: selected ? 0.9 : 0.5,
        });
      }
    }
    if (draftRing !== undefined)
      strokeTrajectory(draft, draftRing, false, { width: 1.8, alpha: 0.9 });
  };

  const drawFigures = (): void => {
    figures.clear();
    if (!viewport || !ringConfig) return;
    const t = timeS ?? 0;

    for (const c of creatures) {
      const pose = creaturePose(c.points, c.loop, c.speedDegPerS * t);
      const p = worldToScreen(viewport, {
        lon: wrapLon(pose.lonLocal + offsetOf(c.ringId)),
        lat: pose.lat,
      });
      if (p.x < -40 || p.y < -40 || p.x > viewport.widthPx + 40 || p.y > viewport.heightPx + 40) {
        continue;
      }
      const angle = (pose.headingDeg * Math.PI) / 180;
      DRAW[c.kind](
        {
          g: figures,
          x: p.x,
          y: p.y,
          cos: Math.cos(angle),
          sin: Math.sin(angle),
          scale: FIGURE_SCALE,
        },
        t,
      );
    }
  };

  const draw = (): void => {
    drawPaths();
    drawFigures();
  };

  return {
    container,
    setCreatures: (next) => {
      creatures = next;
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
      // Les trajectoires ne bougent pas avec l'horloge : seules les figures.
      drawFigures();
    },
    setEditing: (next) => {
      editing = next;
      drawPaths();
    },
    setSelected: (id) => {
      selectedId = id;
      drawPaths();
    },
    setDraft: (points, ringId) => {
      draft = points;
      draftRing = ringId;
      drawPaths();
    },
    destroy: () => container.destroy({ children: true }),
  };
}

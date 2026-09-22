/**
 * Gestes d'édition sur le canvas.
 *
 * La conversion écran → local vit dans src/model/viewport ; ce module ne fait
 * que l'appeler, appliquer l'outil, et refermer le geste en une commande
 * unique. Voir docs/editeur.md.
 */

import { paintBiome, paintRelief, type BrushShape, type ReliefBrush } from '@/edit/brush';
import {
  rasterCommand,
  placesCommand,
  roadsCommand,
  type Command,
  type EditTarget,
} from '@/edit/history';
import { GestureRecorder } from '@/edit/patch';
import { buildRoads, snapToPlace, type Point } from '@/edit/roads';
import { nameForPlace } from '@/gen/names';
import { hashSeed } from '@/gen/rng';
import { columnOfLon, rowOfLat } from '@/model/coords';
import { ringOf, type RingConfig } from '@/model/ring';
import { screenToLocal, type Viewport } from '@/model/viewport';
import type { Place } from '@/model/world';
import type { Tool } from '@/store/editStore';

export interface EditContext {
  readonly getTool: () => Tool;
  readonly getViewport: () => Viewport;
  readonly getRingConfig: () => RingConfig;
  readonly getTDays: () => number;
  readonly getTarget: () => EditTarget | undefined;
  readonly getRelief: () => ReliefBrush;
  readonly getBiomeShape: () => BrushShape;
  readonly getBiomeValue: () => number;
  /** Zone du raster local modifiée par le dernier pas, à téléverser. */
  readonly onRasterTouched: (layer: 'height' | 'biomeOverride') => void;
  readonly onCommand: (command: Command) => void;
  /** Tracé en cours, pour que le rendu puisse l'afficher. */
  readonly onDraftRoad: (points: readonly Point[]) => void;
}

export interface EditControls {
  destroy: () => void;
  /** Termine le tracé de route en cours, s'il y en a un. */
  finishRoad: () => void;
}

/** Distance d'accrochage aux lieux, en pixels écran. */
const SNAP_PX = 12;

export function attachEditControls(element: HTMLElement, context: EditContext): EditControls {
  let painting = false;
  let recorder: GestureRecorder | undefined;
  let draft: Point[] = [];

  const localAt = (event: PointerEvent): { lon: number; lat: number } => {
    const rect = element.getBoundingClientRect();
    return screenToLocal(
      context.getViewport(),
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      context.getRingConfig(),
      context.getTDays(),
    );
  };

  const paintAt = (event: PointerEvent): void => {
    const target = context.getTarget();
    if (!target || !recorder) return;

    const { lon, lat } = localAt(event);
    const x = columnOfLon(lon, target.size.width);
    const y = rowOfLat(lat, target.size.height);
    const tool = context.getTool();

    if (tool === 'relief') {
      paintRelief(target.size, target.height, x, y, context.getRelief(), recorder);
      context.onRasterTouched('height');
    } else if (tool === 'biome') {
      paintBiome(
        target.size,
        target.biomeOverride,
        x,
        y,
        context.getBiomeShape(),
        context.getBiomeValue(),
        recorder,
      );
      context.onRasterTouched('biomeOverride');
    }
  };

  const endStroke = (): void => {
    const target = context.getTarget();
    if (!painting || !recorder || !target) {
      painting = false;
      recorder = undefined;
      return;
    }

    const layer = recorder.layer;
    const source = layer === 'height' ? target.height : target.biomeOverride;
    const patch = recorder.finish(source);

    // Tous les pas du geste ne font qu'une entrée de pile : un Ctrl+Z annule le
    // trait, pas un pas de souris.
    if (patch) {
      context.onCommand(
        rasterCommand(layer === 'height' ? 'coup de pinceau' : 'biome peint', patch),
      );
    }

    painting = false;
    recorder = undefined;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const tool = context.getTool();
    const target = context.getTarget();
    if (!target) return;

    if (tool === 'relief' || tool === 'biome') {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      painting = true;
      recorder = new GestureRecorder(tool === 'relief' ? 'height' : 'biomeOverride', target.size);
      paintAt(event);
      return;
    }

    if (tool === 'place') {
      event.preventDefault();
      addPlace(context, localAt(event));
      return;
    }

    if (tool === 'road') {
      event.preventDefault();
      const point = snapPoint(context, localAt(event));
      draft = [...draft, point];
      context.onDraftRoad(draft);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!painting) return;
    paintAt(event);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    endStroke();
  };

  const finishRoad = (): void => {
    if (draft.length < 2) {
      draft = [];
      context.onDraftRoad(draft);
      return;
    }

    const target = context.getTarget();
    if (!target) return;

    const before = target.roads;
    const after = [...before, ...buildRoads(draft, context.getRingConfig())];
    const command = roadsCommand('route tracée', before, after);
    command.apply(target);
    context.onCommand(command);

    draft = [];
    context.onDraftRoad(draft);
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (context.getTool() !== 'road') return;
    event.preventDefault();
    finishRoad();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && context.getTool() === 'road') finishRoad();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('dblclick', onDoubleClick);
  window.addEventListener('keydown', onKeyDown);

  return {
    finishRoad,
    destroy: () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}

/** Accroche le point au lieu voisin, s'il y en a un à portée. */
function snapPoint(context: EditContext, local: { lon: number; lat: number }): Point {
  const target = context.getTarget();
  if (!target) return [local.lon, local.lat];

  const maxDeg = SNAP_PX / context.getViewport().pixelsPerDegree;
  const place = snapToPlace(local.lon, local.lat, target.places, maxDeg);
  return place ? [place.lon, place.lat] : [local.lon, local.lat];
}

function addPlace(context: EditContext, local: { lon: number; lat: number }): void {
  const target = context.getTarget();
  if (!target) return;

  // L'anneau n'est jamais choisi par le MJ : il découle de la latitude.
  const ringId = ringOf(local.lat, context.getRingConfig());
  const id = `place-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  const place: Place = {
    id,
    ringId,
    lon: local.lon,
    lat: local.lat,
    name: nameForPlace(ringId, hashSeed(id, 'names')),
    kind: 'town',
    size: 2,
  };

  const before = target.places;
  const command = placesCommand('lieu posé', before, [...before, place]);
  command.apply(target);
  context.onCommand(command);
}

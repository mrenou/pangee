/**
 * Gestes d'édition sur le canvas.
 *
 * La conversion écran → local vit dans src/model/viewport ; ce module ne fait
 * que l'appeler, appliquer l'outil, et refermer le geste en une commande
 * unique. Voir docs/editeur.md.
 */

import {
  paintBiome,
  paintFog,
  paintRelief,
  type BrushShape,
  type FogBrush,
  type ReliefBrush,
} from '@/edit/brush';
import {
  rasterCommand,
  placesCommand,
  roadsCommand,
  type Command,
  type EditTarget,
} from '@/edit/history';
import { GestureRecorder } from '@/edit/patch';
import { movePlace, placeAtWorld } from '@/edit/places';
import { buildRoads, roadAtWorld, snapToPlace, type Point } from '@/edit/roads';
import { nameForPlace } from '@/gen/names';
import { findRoadPath } from '@/gen/roadPath';
import { hashSeed } from '@/gen/rng';
import { columnOfLon, rowOfLat } from '@/model/coords';
import { ringOf, type RingConfig } from '@/model/ring';
import { screenToLocal, screenToWorld, type Viewport } from '@/model/viewport';
import type { Place, RoadKind } from '@/model/world';
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
  readonly getFogBrush: () => FogBrush;
  /** Outil route : faire suivre le relief à chaque nouveau segment. */
  readonly getRoadFollowsTerrain: () => boolean;
  readonly getNewRoadKind: () => RoadKind;
  readonly getSeaLevelM: () => number;
  readonly getRadiusKm: () => number;
  /** Zone du raster local modifiée par le dernier pas, à téléverser. */
  readonly onRasterTouched: (layer: 'height' | 'biomeOverride' | 'fog') => void;
  readonly onCommand: (command: Command) => void;
  /** Tracé en cours, pour que le rendu puisse l'afficher. */
  readonly onDraftRoad: (points: readonly Point[]) => void;
  /** Lieu ouvert dans l'inspecteur, ou aucun. */
  readonly onSelectPlace: (id: string | undefined) => void;
  /** Route ouverte dans l'inspecteur, ou aucune. */
  readonly onSelectRoad: (id: string | undefined) => void;
  /** Touche Suppr sur la carte : supprime le lieu ou la route sélectionné. */
  readonly onDeleteSelection: () => void;
}

export interface EditControls {
  destroy: () => void;
  /** Termine le tracé de route en cours, s'il y en a un. */
  finishRoad: () => void;
}

/** Distance d'accrochage aux lieux, en pixels écran. */
const SNAP_PX = 12;

/** Lieu saisi à la souris : la liste d'avant le geste fait le `before` de la commande. */
interface PlaceDrag {
  readonly id: string;
  readonly before: readonly Place[];
  moved: boolean;
}

/** Une frappe dans un champ de saisie ne doit jamais supprimer un lieu. */
function isTyping(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function attachEditControls(element: HTMLElement, context: EditContext): EditControls {
  let painting = false;
  let recorder: GestureRecorder | undefined;
  let draft: Point[] = [];
  /** Longueur du brouillon avant chaque clic : `Retour arrière` retire le dernier tronçon entier. */
  let legs: number[] = [];
  let drag: PlaceDrag | undefined;

  const screenOf = (event: PointerEvent): { x: number; y: number } => {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const localAt = (event: PointerEvent): { lon: number; lat: number } =>
    screenToLocal(
      context.getViewport(),
      screenOf(event),
      context.getRingConfig(),
      context.getTDays(),
    );

  /** Route affichée sous le curseur, à quelques pixels près. */
  const roadUnder = (event: PointerEvent, target: EditTarget) => {
    const viewport = context.getViewport();
    const world = screenToWorld(viewport, screenOf(event));
    return roadAtWorld(
      world.lon,
      world.lat,
      target.roads,
      context.getRingConfig(),
      context.getTDays(),
      SNAP_PX / viewport.pixelsPerDegree,
    );
  };

  /** Lieu affiché sous le curseur, à quelques pixels près. */
  const placeUnder = (event: PointerEvent, places: readonly Place[]): Place | undefined => {
    const viewport = context.getViewport();
    const world = screenToWorld(viewport, screenOf(event));
    return placeAtWorld(
      world.lon,
      world.lat,
      places,
      context.getRingConfig(),
      context.getTDays(),
      SNAP_PX / viewport.pixelsPerDegree,
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
    } else if (tool === 'fog') {
      // Le brouillard a sa propre grille, plus grossière que le relief.
      paintFog(
        target.fogSize,
        target.fog,
        columnOfLon(lon, target.fogSize.width),
        rowOfLat(lat, target.fogSize.height),
        context.getFogBrush(),
        recorder,
      );
      context.onRasterTouched('fog');
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
    const source =
      layer === 'height' ? target.height : layer === 'fog' ? target.fog : target.biomeOverride;
    const patch = recorder.finish(source);
    const label =
      layer === 'height' ? 'coup de pinceau' : layer === 'fog' ? 'brouillard peint' : 'biome peint';

    // Tous les pas du geste ne font qu'une entrée de pile : un Ctrl+Z annule le
    // trait, pas un pas de souris.
    if (patch) context.onCommand(rasterCommand(label, patch));

    painting = false;
    recorder = undefined;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const tool = context.getTool();
    const target = context.getTarget();
    if (!target) return;

    if (tool === 'relief' || tool === 'biome' || tool === 'fog') {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      painting = true;
      recorder =
        tool === 'fog'
          ? new GestureRecorder('fog', target.fogSize)
          : new GestureRecorder(tool === 'relief' ? 'height' : 'biomeOverride', target.size);
      paintAt(event);
      return;
    }

    if (tool === 'place') {
      event.preventDefault();
      const hit = placeUnder(event, target.places);
      if (hit) {
        // Saisir un lieu l'ouvre dans l'inspecteur ; le glisser le déplace.
        context.onSelectPlace(hit.id);
        element.setPointerCapture(event.pointerId);
        drag = { id: hit.id, before: target.places, moved: false };
      } else {
        context.onSelectPlace(addPlace(context, localAt(event)));
      }
      return;
    }

    if (tool === 'road') {
      event.preventDefault();
      // Hors tracé, un clic sur une route l'ouvre. Un lieu l'emporte : c'est
      // de là que partent les routes. Maj force le début d'un tracé.
      if (draft.length === 0 && !event.shiftKey && !placeUnder(event, target.places)) {
        const hit = roadUnder(event, target);
        if (hit) {
          context.onSelectRoad(hit.id);
          return;
        }
      }
      context.onSelectRoad(undefined);
      const point = snapPoint(context, localAt(event));
      legs = [...legs, draft.length];
      draft = [...draft, ...roadLeg(context, target, draft[draft.length - 1], point)];
      context.onDraftRoad(draft);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (drag) {
      const target = context.getTarget();
      if (!target) return;
      const { lon, lat } = localAt(event);
      // Aperçu au fil du geste ; la commande ne sera empilée qu'au lâcher.
      target.places = movePlace(drag.before, drag.id, lon, lat, context.getRingConfig());
      drag.moved = true;
      return;
    }
    if (!painting) return;
    paintAt(event);
  };

  const endDrag = (): void => {
    const target = context.getTarget();
    if (drag?.moved && target) {
      context.onCommand(placesCommand('lieu déplacé', drag.before, target.places));
    }
    drag = undefined;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    endDrag();
    endStroke();
  };

  const finishRoad = (): void => {
    if (draft.length < 2) {
      draft = [];
      legs = [];
      context.onDraftRoad(draft);
      return;
    }

    const target = context.getTarget();
    if (!target) return;

    const before = target.roads;
    // Préfixe unique : le compteur des identifiants repart de zéro à chaque
    // chargement, alors que les routes déjà enregistrées gardent les leurs.
    const prefix = `road-${Date.now().toString(36)}`;
    const built = buildRoads(draft, context.getRingConfig(), context.getNewRoadKind(), prefix);
    const after = [...before, ...built];
    const command = roadsCommand('route tracée', before, after);
    command.apply(target);
    context.onCommand(command);

    draft = [];
    legs = [];
    context.onDraftRoad(draft);
  };

  /** Retire le dernier tronçon du brouillon : c'est ainsi qu'on rejette un tracé proposé. */
  const dropLastLeg = (): void => {
    const length = legs.pop();
    if (length === undefined) return;
    draft = draft.slice(0, length);
    context.onDraftRoad(draft);
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (context.getTool() !== 'road') return;
    event.preventDefault();
    finishRoad();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && context.getTool() === 'road') finishRoad();
    if (isTyping(event) || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
    const tool = context.getTool();
    if (tool === 'road' && draft.length > 0) {
      event.preventDefault();
      if (event.key === 'Backspace') dropLastLeg();
      return;
    }
    if (tool === 'place' || tool === 'road') {
      event.preventDefault();
      context.onDeleteSelection();
    }
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

/**
 * Points à ajouter au brouillon pour rejoindre `point`. En ligne droite, le
 * point seul ; en suivant le relief, le tracé de moindre coût depuis le point
 * précédent — ou la ligne droite si les deux points sont trop éloignés pour
 * la fenêtre de recherche.
 */
function roadLeg(
  context: EditContext,
  target: EditTarget,
  previous: Point | undefined,
  point: Point,
): readonly Point[] {
  if (!previous || !context.getRoadFollowsTerrain()) return [point];
  const path = findRoadPath(target.size, target.height, previous, point, {
    radiusKm: context.getRadiusKm(),
    seaLevelM: context.getSeaLevelM(),
  });
  return path ? path.slice(1) : [point];
}

/** Accroche le point au lieu voisin, s'il y en a un à portée. */
function snapPoint(context: EditContext, local: { lon: number; lat: number }): Point {
  const target = context.getTarget();
  if (!target) return [local.lon, local.lat];

  const maxDeg = SNAP_PX / context.getViewport().pixelsPerDegree;
  const place = snapToPlace(local.lon, local.lat, target.places, maxDeg);
  return place ? [place.lon, place.lat] : [local.lon, local.lat];
}

/** Pose un lieu et renvoie son identifiant. */
function addPlace(context: EditContext, local: { lon: number; lat: number }): string | undefined {
  const target = context.getTarget();
  if (!target) return undefined;

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
  return id;
}

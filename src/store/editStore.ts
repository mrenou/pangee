/**
 * Réglages d'édition et pile d'annulation.
 *
 * La pile elle-même vit hors du state : c'est une structure mutable, que
 * Zustand n'a pas à recopier. Le store n'en expose que ce dont l'interface a
 * besoin. Voir docs/editeur.md.
 */

import { create } from 'zustand';
import { Biome } from '@/climate';
import {
  fillFog,
  type BrushShape,
  type FogBrush,
  type ReliefBrush,
  type ReliefMode,
} from '@/edit/brush';
import { GestureRecorder } from '@/edit/patch';
import {
  History,
  creaturesCommand,
  placesCommand,
  ringsCommand,
  rasterCommand,
  roadsCommand,
  type Command,
  type EditTarget,
  type RingState,
} from '@/edit/history';
import { removePlace, updatePlace, type PlaceEdit } from '@/edit/places';
import { removeRoad, setRoadKind } from '@/edit/roads';
import { removeCreature, updateCreature, type CreatureEdit } from '@/edit/creatures';
import { reassignToRings } from '@/edit/rings';
import { moveCut, ringBounds, removeCut, splitRing, type RingConfig } from '@/model/ring';
import type { CreatureKind, RoadKind } from '@/model/world';
import { useWorldStore } from '@/store/worldStore';

export type Tool = 'pan' | 'relief' | 'biome' | 'place' | 'road' | 'creature' | 'fog' | 'export';

export const history = new History();

/** Vue mutable du monde, telle que les commandes savent la manipuler. */
export function editTarget(): EditTarget | undefined {
  const world = useWorldStore.getState();
  if (!world.height || !world.biomeOverride || !world.fog) return undefined;

  return {
    size: world.rasterSize,
    height: world.height,
    biomeOverride: world.biomeOverride,
    fogSize: world.fogSize,
    fog: world.fog,
    get places() {
      return useWorldStore.getState().places;
    },
    set places(next) {
      useWorldStore.getState().setPlaces(next);
    },
    get roads() {
      return useWorldStore.getState().roads;
    },
    set roads(next) {
      useWorldStore.getState().setRoads(next);
    },
    get creatures() {
      return useWorldStore.getState().creatures;
    },
    set creatures(next) {
      useWorldStore.getState().setCreatures(next);
    },
    get ringConfig() {
      return useWorldStore.getState().ringConfig;
    },
    set ringConfig(next) {
      useWorldStore.getState().setRingConfig(next);
    },
  };
}

interface EditState {
  tool: Tool;
  relief: ReliefBrush;
  biomeShape: BrushShape;
  biomeValue: number;
  fogBrush: FogBrush;
  /** Voile du brouillard sur la carte, même hors de l'outil brouillard. */
  showFogPreview: boolean;
  /** Outil route : chaque segment suit le relief (A*) au lieu d'aller droit. */
  roadFollowsTerrain: boolean;
  /** Type donné aux routes tracées. */
  newRoadKind: RoadKind;
  /** Route ouverte dans l'inspecteur ; même règle que pour les lieux. */
  selectedRoadId: string | undefined;
  newCreatureKind: CreatureKind;
  selectedCreatureId: string | undefined;
  /** Lieu ouvert dans l'inspecteur. Un identifiant qui ne correspond plus à
   * aucun lieu (après une annulation, par exemple) vaut absence de sélection. */
  selectedPlaceId: string | undefined;
  /** Le monde a-t-il reçu au moins une commande ? Conditionne l'avertissement
   * avant régénération. */
  edited: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;

  setTool: (tool: Tool) => void;
  setReliefMode: (mode: ReliefMode) => void;
  setRelief: (patch: Partial<ReliefBrush>) => void;
  setBiomeShape: (patch: Partial<BrushShape>) => void;
  setBiomeValue: (value: number) => void;
  setFogBrush: (patch: Partial<FogBrush>) => void;
  setShowFogPreview: (show: boolean) => void;
  /** Révèle (255) ou cache (0) toute la planète, en une commande. */
  fillFog: (value: number, label: string) => void;
  setRoadFollowsTerrain: (follow: boolean) => void;
  setNewRoadKind: (kind: RoadKind) => void;
  selectRoad: (id: string | undefined) => void;
  setSelectedRoadKind: (kind: RoadKind) => void;
  setNewCreatureKind: (kind: CreatureKind) => void;
  selectCreature: (id: string | undefined) => void;
  editCreature: (edit: CreatureEdit, label: string) => void;
  /** Coupe un anneau en deux en son milieu, en une commande annulable. */
  splitRing: (index: number) => void;
  /** Supprime une coupure : les deux anneaux voisins fusionnent. Annulable. */
  mergeAtCut: (cutIndex: number) => void;
  /**
   * Déplace une coupure et réaffecte lieux, routes et créatures. Tout un
   * glissement du curseur ne fait qu'une commande, voir `holdRingGesture`.
   */
  moveCut: (cutIndex: number, latDeg: number) => void;
  /** Règle la vitesse d'un anneau, coalescée comme les coupures. */
  setRingSpeed: (ringId: string, omegaDegPerDay: number) => void;
  /** Le MJ saisit un curseur d'anneau : le geste dure jusqu'au lâcher. */
  holdRingGesture: () => void;
  /** Le MJ lâche le curseur : le geste devient une commande. */
  releaseRingGesture: () => void;
  /** Supprime le lieu, la route ou la créature sélectionné, selon l'outil actif. */
  deleteSelection: () => void;
  selectPlace: (id: string | undefined) => void;
  /** Retouche le lieu sélectionné, en une commande annulable. */
  editPlace: (edit: PlaceEdit, label: string) => void;
  deleteSelectedPlace: () => void;

  /** Applique une commande déjà exécutée sur la cible et l'empile. */
  record: (command: Command) => void;
  undo: () => void;
  redo: () => void;
  resetHistory: () => void;
  /** Régénère le monde ; la pile d'annulation, devenue sans objet, est vidée. */
  regenerate: () => Promise<void>;
  /** Remplace le monde par un fichier, et vide de même la pile d'annulation. */
  importWorld: (file: File) => Promise<void>;
  /** Rouvre la carte de Pangée livrée avec le site, et vide la pile d'annulation. */
  loadDefaultWorld: () => Promise<void>;
}

const DEFAULT_RELIEF: ReliefBrush = {
  mode: 'raise',
  radius: 12,
  falloff: 0.7,
  strengthM: 120,
};

/** État des anneaux tel qu'une commande l'échange. */
function ringState(target: EditTarget): RingState {
  return {
    ringConfig: target.ringConfig,
    places: target.places,
    roads: target.roads,
    creatures: target.creatures,
  };
}

/**
 * Réglage d'anneau en cours : l'état d'avant le premier mouvement, et le nom
 * de la commande qu'il deviendra. Un glissement de curseur produit des
 * dizaines de valeurs ; on n'en garde qu'une entrée de pile, comme pour un
 * coup de pinceau.
 */
interface RingGesture {
  readonly before: RingState;
  /** Fixé par le premier réglage ; un curseur tout juste saisi n'en a pas encore. */
  label: string | undefined;
  /** Curseur tenu à la souris : on attend le lâcher. */
  held: boolean;
}

let ringGesture: RingGesture | undefined;
let ringGestureTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Délai d'inactivité qui clôt un réglage fait au clavier ou par saisie
 * directe, sans lâcher de souris pour le signaler.
 */
export const RING_GESTURE_IDLE_MS = 400;

/** Ouvre le geste s'il ne l'est pas déjà ; deux réglages différents se fondent en un. */
function touchRingGesture(target: EditTarget, label: string, commit: () => void): void {
  if (!ringGesture) ringGesture = { before: ringState(target), label, held: false };
  else if (ringGesture.label === undefined) ringGesture.label = label;
  else if (ringGesture.label !== label) ringGesture.label = 'anneaux réglés';
  if (ringGestureTimer !== undefined) clearTimeout(ringGestureTimer);
  ringGestureTimer = ringGesture.held ? undefined : setTimeout(commit, RING_GESTURE_IDLE_MS);
}

/** Applique un nouveau découpage, réaffecte les objets, et empile la commande. */
function applyRingChange(
  target: EditTarget,
  next: RingConfig,
  label: string,
  record: (command: Command) => void,
): void {
  const before = ringState(target);
  const after = { ringConfig: next, ...reassignToRings(target, next) };
  const command = ringsCommand(label, before, after);
  command.apply(target);
  record(command);
  useWorldStore.getState().scheduleAutosave();
}

function syncFlags(): Pick<EditState, 'canUndo' | 'canRedo' | 'undoLabel'> {
  return { canUndo: history.canUndo, canRedo: history.canRedo, undoLabel: history.undoLabel };
}

export const useEditStore = create<EditState>((set, get) => ({
  tool: 'pan',
  relief: DEFAULT_RELIEF,
  biomeShape: { radius: 10, falloff: 0 },
  biomeValue: Biome.TemperateForest,
  fogBrush: { mode: 'reveal', radius: 4, falloff: 0.6, strength: 0.5 },
  showFogPreview: false,
  roadFollowsTerrain: false,
  newRoadKind: 'road',
  selectedRoadId: undefined,
  newCreatureKind: 'dragon',
  selectedCreatureId: undefined,
  selectedPlaceId: undefined,
  edited: false,
  canUndo: false,
  canRedo: false,
  undoLabel: undefined,

  setTool: (tool) => set({ tool }),
  setReliefMode: (mode) => set((s) => ({ relief: { ...s.relief, mode } })),
  setRelief: (patch) => set((s) => ({ relief: { ...s.relief, ...patch } })),
  setBiomeShape: (patch) => set((s) => ({ biomeShape: { ...s.biomeShape, ...patch } })),
  setBiomeValue: (biomeValue) => set({ biomeValue }),
  setFogBrush: (patch) => set((s) => ({ fogBrush: { ...s.fogBrush, ...patch } })),
  setShowFogPreview: (showFogPreview) => set({ showFogPreview }),

  fillFog: (value, label) => {
    const target = editTarget();
    if (!target) return;
    const recorder = new GestureRecorder('fog', target.fogSize);
    fillFog(target.fogSize, target.fog, value, recorder);
    const patch = recorder.finish(target.fog);
    if (!patch) return;
    get().record(rasterCommand(label, patch));
    useWorldStore.getState().bumpFogVersion();
    useWorldStore.getState().scheduleAutosave();
  },
  setRoadFollowsTerrain: (roadFollowsTerrain) => set({ roadFollowsTerrain }),
  setNewRoadKind: (newRoadKind) => set({ newRoadKind }),
  selectRoad: (selectedRoadId) => set({ selectedRoadId }),
  setNewCreatureKind: (newCreatureKind) => set({ newCreatureKind }),

  splitRing: (index) => {
    const target = editTarget();
    if (!target) return;
    const { north, south } = ringBounds(target.ringConfig, index);
    const next = splitRing(target.ringConfig, index, Math.round((north + south) / 2));
    if (next) applyRingChange(target, next, 'anneau scindé', get().record);
  },

  mergeAtCut: (cutIndex) => {
    const target = editTarget();
    if (!target) return;
    const next = removeCut(target.ringConfig, cutIndex);
    if (next) applyRingChange(target, next, 'anneaux fusionnés', get().record);
  },

  moveCut: (cutIndex, latDeg) => {
    const target = editTarget();
    if (!target) return;
    touchRingGesture(target, 'coupure déplacée', flushRingGesture);
    // On repart toujours de l'état d'avant le geste : une route coupée en
    // chemin par une coupure qui ne fait que passer ne reste pas en morceaux.
    const before = ringGesture!.before;
    const next = moveCut(target.ringConfig, cutIndex, latDeg);
    const objects = reassignToRings(before, next);
    target.ringConfig = next;
    target.places = objects.places;
    target.roads = objects.roads;
    target.creatures = objects.creatures;
  },

  setRingSpeed: (ringId, omegaDegPerDay) => {
    const target = editTarget();
    if (!target) return;
    touchRingGesture(target, 'vitesse d’anneau', flushRingGesture);
    useWorldStore.getState().setOmega(ringId, omegaDegPerDay);
  },

  holdRingGesture: () => {
    const target = editTarget();
    if (!target) return;
    if (ringGestureTimer !== undefined) clearTimeout(ringGestureTimer);
    ringGestureTimer = undefined;
    ringGesture ??= { before: ringState(target), label: undefined, held: true };
    ringGesture.held = true;
  },

  releaseRingGesture: () => flushRingGesture(),
  selectCreature: (selectedCreatureId) => set({ selectedCreatureId }),

  editCreature: (edit, label) => {
    const target = editTarget();
    const id = get().selectedCreatureId;
    if (!target || id === undefined) return;
    const before = target.creatures;
    const command = creaturesCommand(label, before, updateCreature(before, id, edit));
    command.apply(target);
    get().record(command);
    useWorldStore.getState().scheduleAutosave();
  },

  setSelectedRoadKind: (kind) => {
    const target = editTarget();
    const id = get().selectedRoadId;
    if (!target || id === undefined) return;
    const before = target.roads;
    const command = roadsCommand('type de route', before, setRoadKind(before, id, kind));
    command.apply(target);
    get().record(command);
    useWorldStore.getState().scheduleAutosave();
  },

  deleteSelection: () => {
    const { tool, selectedRoadId, selectedCreatureId } = get();
    if (tool === 'place') {
      get().deleteSelectedPlace();
      return;
    }
    if (tool === 'creature') {
      const target = editTarget();
      if (!target || selectedCreatureId === undefined) return;
      const before = target.creatures;
      const command = creaturesCommand(
        'créature retirée',
        before,
        removeCreature(before, selectedCreatureId),
      );
      command.apply(target);
      get().record(command);
      set({ selectedCreatureId: undefined });
      useWorldStore.getState().scheduleAutosave();
      return;
    }
    const target = editTarget();
    if (tool !== 'road' || !target || selectedRoadId === undefined) return;
    const before = target.roads;
    const command = roadsCommand('route supprimée', before, removeRoad(before, selectedRoadId));
    command.apply(target);
    get().record(command);
    set({ selectedRoadId: undefined });
    useWorldStore.getState().scheduleAutosave();
  },
  selectPlace: (selectedPlaceId) => set({ selectedPlaceId }),

  editPlace: (edit, label) => {
    const target = editTarget();
    const id = get().selectedPlaceId;
    if (!target || id === undefined) return;
    const before = target.places;
    const command = placesCommand(label, before, updatePlace(before, id, edit));
    command.apply(target);
    get().record(command);
    useWorldStore.getState().scheduleAutosave();
  },

  deleteSelectedPlace: () => {
    const target = editTarget();
    const id = get().selectedPlaceId;
    if (!target || id === undefined) return;
    const before = target.places;
    const command = placesCommand('lieu supprimé', before, removePlace(before, id));
    command.apply(target);
    get().record(command);
    set({ selectedPlaceId: undefined });
    useWorldStore.getState().scheduleAutosave();
  },

  record: (command) => {
    // Un réglage d'anneau en suspens passe avant : l'ordre de la pile est
    // celui des gestes.
    flushRingGesture();
    history.push(command);
    set({ edited: true, ...syncFlags() });
  },

  // Annuler et rétablir modifient le monde autant qu'un coup de pinceau :
  // sans cela, l'enregistrement garderait un état que le MJ ne voit plus.
  undo: () => {
    const target = editTarget();
    if (!target) return;
    flushRingGesture();
    const command = history.undo(target);
    set(syncFlags());
    if (command?.kind === 'raster') useWorldStore.getState().bumpHeightVersion();
    if (command?.kind === 'fog') useWorldStore.getState().bumpFogVersion();
    useWorldStore.getState().scheduleAutosave();
  },

  redo: () => {
    const target = editTarget();
    if (!target) return;
    flushRingGesture();
    const command = history.redo(target);
    set(syncFlags());
    if (command?.kind === 'raster') useWorldStore.getState().bumpHeightVersion();
    if (command?.kind === 'fog') useWorldStore.getState().bumpFogVersion();
    useWorldStore.getState().scheduleAutosave();
  },

  resetHistory: () => {
    discardRingGesture();
    history.clear();
    set({ edited: false, ...syncFlags() });
  },

  // Les commandes de la pile visent l'ancien monde : annuler un coup de
  // pinceau rejouerait son patch sur un relief qui n'a plus rien à voir.
  regenerate: async () => {
    if (await useWorldStore.getState().regenerate()) get().resetHistory();
  },

  importWorld: async (file) => {
    if (await useWorldStore.getState().importWorld(file)) get().resetHistory();
  },

  loadDefaultWorld: async () => {
    if (await useWorldStore.getState().loadDefaultWorld()) get().resetHistory();
  },
}));

/**
 * Clôt le réglage d'anneau en cours : s'il a changé quelque chose, il devient
 * une commande, déjà appliquée. Sans effet s'il n'y a rien en suspens.
 */
function flushRingGesture(): void {
  if (ringGestureTimer !== undefined) clearTimeout(ringGestureTimer);
  ringGestureTimer = undefined;
  const gesture = ringGesture;
  ringGesture = undefined;
  const target = editTarget();
  if (!gesture || !target) return;
  // Revenu à son point de départ, le geste n'a rien changé : on remet les
  // objets d'origine plutôt que leurs copies réaffectées.
  if (JSON.stringify(gesture.before.ringConfig) === JSON.stringify(target.ringConfig)) {
    target.places = gesture.before.places;
    target.roads = gesture.before.roads;
    target.creatures = gesture.before.creatures;
    return;
  }
  const after = ringState(target);

  history.push(ringsCommand(gesture.label ?? 'anneaux réglés', gesture.before, after));
  useEditStore.setState({ edited: true, ...syncFlags() });
  useWorldStore.getState().scheduleAutosave();
}

/** Abandonne le réglage en cours sans l'empiler : le monde vient d'être remplacé. */
function discardRingGesture(): void {
  if (ringGestureTimer !== undefined) clearTimeout(ringGestureTimer);
  ringGestureTimer = undefined;
  ringGesture = undefined;
}

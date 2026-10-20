/**
 * Réglages d'édition et pile d'annulation.
 *
 * La pile elle-même vit hors du state : c'est une structure mutable, que
 * Zustand n'a pas à recopier. Le store n'en expose que ce dont l'interface a
 * besoin. Voir docs/editeur.md.
 */

import { create } from 'zustand';
import { Biome } from '@/climate';
import type { BrushShape, ReliefBrush, ReliefMode } from '@/edit/brush';
import {
  History,
  placesCommand,
  roadsCommand,
  type Command,
  type EditTarget,
} from '@/edit/history';
import { removePlace, updatePlace, type PlaceEdit } from '@/edit/places';
import { removeRoad, setRoadKind } from '@/edit/roads';
import type { RoadKind } from '@/model/world';
import { useWorldStore } from '@/store/worldStore';

export type Tool = 'pan' | 'relief' | 'biome' | 'place' | 'road';

export const history = new History();

/** Vue mutable du monde, telle que les commandes savent la manipuler. */
export function editTarget(): EditTarget | undefined {
  const world = useWorldStore.getState();
  if (!world.height || !world.biomeOverride) return undefined;

  return {
    size: world.rasterSize,
    height: world.height,
    biomeOverride: world.biomeOverride,
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
  };
}

interface EditState {
  tool: Tool;
  relief: ReliefBrush;
  biomeShape: BrushShape;
  biomeValue: number;
  /** Outil route : chaque segment suit le relief (A*) au lieu d'aller droit. */
  roadFollowsTerrain: boolean;
  /** Type donné aux routes tracées. */
  newRoadKind: RoadKind;
  /** Route ouverte dans l'inspecteur ; même règle que pour les lieux. */
  selectedRoadId: string | undefined;
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
  setRoadFollowsTerrain: (follow: boolean) => void;
  setNewRoadKind: (kind: RoadKind) => void;
  selectRoad: (id: string | undefined) => void;
  setSelectedRoadKind: (kind: RoadKind) => void;
  /** Supprime le lieu ou la route sélectionné, selon l'outil actif. */
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
}

const DEFAULT_RELIEF: ReliefBrush = {
  mode: 'raise',
  radius: 12,
  falloff: 0.7,
  strengthM: 120,
};

function syncFlags(): Pick<EditState, 'canUndo' | 'canRedo' | 'undoLabel'> {
  return { canUndo: history.canUndo, canRedo: history.canRedo, undoLabel: history.undoLabel };
}

export const useEditStore = create<EditState>((set, get) => ({
  tool: 'pan',
  relief: DEFAULT_RELIEF,
  biomeShape: { radius: 10, falloff: 0 },
  biomeValue: Biome.TemperateForest,
  roadFollowsTerrain: false,
  newRoadKind: 'road',
  selectedRoadId: undefined,
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
  setRoadFollowsTerrain: (roadFollowsTerrain) => set({ roadFollowsTerrain }),
  setNewRoadKind: (newRoadKind) => set({ newRoadKind }),
  selectRoad: (selectedRoadId) => set({ selectedRoadId }),

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
    const { tool, selectedRoadId } = get();
    if (tool === 'place') {
      get().deleteSelectedPlace();
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
    history.push(command);
    set({ edited: true, ...syncFlags() });
  },

  // Annuler et rétablir modifient le monde autant qu'un coup de pinceau :
  // sans cela, l'enregistrement garderait un état que le MJ ne voit plus.
  undo: () => {
    const target = editTarget();
    if (!target) return;
    const command = history.undo(target);
    set(syncFlags());
    if (command?.kind === 'raster') useWorldStore.getState().bumpHeightVersion();
    useWorldStore.getState().scheduleAutosave();
  },

  redo: () => {
    const target = editTarget();
    if (!target) return;
    const command = history.redo(target);
    set(syncFlags());
    if (command?.kind === 'raster') useWorldStore.getState().bumpHeightVersion();
    useWorldStore.getState().scheduleAutosave();
  },

  resetHistory: () => {
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
}));

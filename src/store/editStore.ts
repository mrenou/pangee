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
import { History, placesCommand, type Command, type EditTarget } from '@/edit/history';
import { removePlace, updatePlace, type PlaceEdit } from '@/edit/places';
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
    history.undo(target);
    set(syncFlags());
    useWorldStore.getState().scheduleAutosave();
  },

  redo: () => {
    const target = editTarget();
    if (!target) return;
    history.redo(target);
    set(syncFlags());
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

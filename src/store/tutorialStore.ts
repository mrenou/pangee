/**
 * Le tutoriel : étape courante, tâches accomplies, et le monde d'avant, que le
 * MJ peut retrouver à la sortie.
 *
 * Le MJ manipule son vrai monde — c'est le but — mais rien ne l'oblige à
 * garder ses essais : le monde est copié à l'ouverture, réglages compris.
 * Voir docs/tutoriel.md.
 */

import { create } from 'zustand';
import type { TerrainParams } from '@/gen';
import type { WorldDocument } from '@/model/file';
import type { WorldRect } from '@/model/viewport';
import { useEditStore, type Tool } from '@/store/editStore';
import { useExportStore } from '@/store/exportStore';
import { advanceTasks, TUTORIAL_STEPS, type Probe } from '@/store/tutorialSteps';
import { useViewportStore } from '@/store/viewportStore';
import { useWorldStore } from '@/store/worldStore';

interface TutorialState {
  active: boolean;
  stepIndex: number;
  /** Tâches accomplies de l'étape courante. */
  done: readonly boolean[];
  /** Le MJ veut sortir et le monde a changé : on lui demande quoi en faire. */
  closing: boolean;

  start: () => void;
  goTo: (stepIndex: number) => void;
  /** Sortie demandée : directe si le tutoriel n'a rien changé, sinon `closing`. */
  requestClose: () => void;
  cancelClose: () => void;
  /** Ferme le tutoriel ; `restore` rend le monde d'avant son ouverture. */
  finish: (restore: boolean) => void;
}

/** Le monde et les réglages tels qu'à l'ouverture du tutoriel. */
interface SavedWorld {
  readonly doc: WorldDocument;
  readonly terrain: TerrainParams;
  readonly placeDensity: number;
  readonly showFaults: boolean;
  readonly bookStyle: boolean;
  readonly animate: boolean;
  readonly edited: boolean;
  readonly tool: Tool;
  readonly exportRect: WorldRect | undefined;
}

let saved: SavedWorld | undefined;
let openingProbe: Probe | undefined;
let stepProbe: Probe | undefined;
/** Une régénération ou un import change le monde sans passer par une commande. */
let openingHeightVersion = 0;
let unsubscribe: (() => void) | undefined;

function readProbe(): Probe {
  const world = useWorldStore.getState();
  const edit = useEditStore.getState();
  return {
    viewport: useViewportStore.getState().viewport,
    tDays: world.tDays,
    playing: world.playing,
    ringConfig: world.ringConfig,
    seaLevelM: world.seaLevelM,
    showFaults: world.showFaults,
    bookStyle: world.bookStyle,
    animate: world.animate,
    terrain: world.terrain,
    placeDensity: world.placeDensity,
    tool: edit.tool,
    selectedPlaceId: edit.selectedPlaceId,
    commandCount: edit.commandCount,
    undoLabel: edit.undoLabel,
    canRedo: edit.canRedo,
    exportRect: useExportStore.getState().rect,
  };
}

/**
 * Le pinceau réécrit le relief et le brouillard en place : sans copie, le
 * monde « d'avant » porterait les traits du tutoriel.
 */
function saveWorld(): SavedWorld | undefined {
  const world = useWorldStore.getState();
  const doc = world.snapshot();
  if (!doc) return undefined;
  const edit = useEditStore.getState();
  return {
    doc: {
      ...doc,
      height: doc.height.slice(),
      biomeOverride: doc.biomeOverride.slice(),
      fog: doc.fog.slice(),
    },
    terrain: world.terrain,
    placeDensity: world.placeDensity,
    showFaults: world.showFaults,
    bookStyle: world.bookStyle,
    animate: world.animate,
    edited: edit.edited,
    tool: edit.tool,
    exportRect: useExportStore.getState().rect,
  };
}

/**
 * Rend le monde sauvegardé. La pile d'annulation est vidée : ses commandes
 * visent le monde que l'on quitte, comme après un import.
 */
function restoreWorld(world: SavedWorld): void {
  const store = useWorldStore.getState();
  store.setPlaying(false);
  store.adopt(world.doc);
  store.setTerrain(world.terrain);
  store.setPlaceDensity(world.placeDensity);
  store.setShowFaults(world.showFaults);
  store.setBookStyle(world.bookStyle);
  store.setAnimate(world.animate);
  useEditStore.getState().resetHistory();
  useEditStore.setState({ edited: world.edited, tool: world.tool });
  useExportStore.getState().setRect(world.exportRect);
  store.scheduleAutosave();
}

/** Le tutoriel a-t-il laissé une trace dans le monde ou ses réglages ? */
function worldChanged(now: Probe, opening: Probe): boolean {
  return (
    now.commandCount !== opening.commandCount ||
    now.tDays !== opening.tDays ||
    now.ringConfig !== opening.ringConfig ||
    now.seaLevelM !== opening.seaLevelM ||
    now.showFaults !== opening.showFaults ||
    now.bookStyle !== opening.bookStyle ||
    now.animate !== opening.animate ||
    now.terrain !== opening.terrain ||
    now.placeDensity !== opening.placeDensity ||
    useWorldStore.getState().heightVersion !== openingHeightVersion
  );
}

export const useTutorialStore = create<TutorialState>((set, get) => {
  const evaluate = (): void => {
    const { active, stepIndex, done } = get();
    const step = TUTORIAL_STEPS[stepIndex];
    if (!active || !step || !stepProbe) return;
    const next = advanceTasks(step.tasks, done, readProbe(), stepProbe);
    if (next.some((value, index) => value !== done[index])) set({ done: next });
  };

  return {
    active: false,
    stepIndex: 0,
    done: [],
    closing: false,

    start: () => {
      if (get().active) return;
      saved = saveWorld();
      if (!saved) return;
      openingProbe = readProbe();
      openingHeightVersion = useWorldStore.getState().heightVersion;
      const unsubscribers = [
        useWorldStore.subscribe(evaluate),
        useEditStore.subscribe(evaluate),
        useExportStore.subscribe(evaluate),
        useViewportStore.subscribe(evaluate),
      ];
      unsubscribe = () => unsubscribers.forEach((stop) => stop());
      set({ active: true, closing: false });
      get().goTo(0);
    },

    goTo: (stepIndex) => {
      const step = TUTORIAL_STEPS[stepIndex];
      if (!step) return;
      if (step.startTool) useEditStore.getState().setTool(step.startTool);
      stepProbe = readProbe();
      set({ stepIndex, done: step.tasks.map(() => false), closing: false });
      evaluate();
    },

    requestClose: () => {
      if (openingProbe && worldChanged(readProbe(), openingProbe)) set({ closing: true });
      else get().finish(false);
    },

    cancelClose: () => set({ closing: false }),

    finish: (restore) => {
      unsubscribe?.();
      unsubscribe = undefined;
      useWorldStore.getState().setPlaying(false);
      if (restore && saved) restoreWorld(saved);
      saved = undefined;
      openingProbe = undefined;
      stepProbe = undefined;
      set({ active: false, closing: false, stepIndex: 0, done: [] });
    },
  };
});

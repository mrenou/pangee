import { describe, expect, it } from 'vitest';
import { DEFAULT_TERRAIN_PARAMS } from '@/gen';
import { DEFAULT_RING_CONFIG } from '@/model/ring';
import {
  advanceTasks,
  targetsOf,
  TUTORIAL_STEPS,
  type Probe,
  type TutorialStep,
} from '@/store/tutorialSteps';

const BASE: Probe = {
  viewport: { centerLonWorld: 0, centerLat: 0, pixelsPerDegree: 6, widthPx: 800, heightPx: 600 },
  tDays: 0,
  playing: false,
  ringConfig: DEFAULT_RING_CONFIG,
  seaLevelM: 0,
  showFaults: true,
  bookStyle: true,
  animate: false,
  terrain: DEFAULT_TERRAIN_PARAMS,
  placeDensity: 0.5,
  tool: 'pan',
  selectedPlaceId: undefined,
  commandCount: 0,
  undoLabel: undefined,
  canRedo: false,
  exportRect: undefined,
};

function step(id: string): TutorialStep {
  const found = TUTORIAL_STEPS.find((s) => s.id === id);
  if (!found) throw new Error(`Étape inconnue : ${id}`);
  return found;
}

describe('advanceTasks', () => {
  it('juge les tâches dans l’ordre et garde celles qui sont faites', () => {
    const { tasks } = step('timelapse');
    // Lecture lancée : la pause n'est pas encore jugée, alors même que la
    // date est au Cataclysme.
    let done = advanceTasks(tasks, [false, false, false], { ...BASE, playing: true }, BASE);
    expect(done).toEqual([true, false, false]);

    // Pause, la date a avancé : lancer la lecture reste acquis.
    done = advanceTasks(tasks, done, { ...BASE, tDays: 120 }, BASE);
    expect(done).toEqual([true, true, false]);

    done = advanceTasks(tasks, done, BASE, BASE);
    expect(done).toEqual([true, true, true]);
  });

  it('ne compte un trait de pinceau que s’il est postérieur à l’entrée dans l’étape', () => {
    const { tasks } = step('relief');
    const start = { ...BASE, commandCount: 3, undoLabel: 'coup de pinceau' };
    const chosen = { ...start, tool: 'relief' as const };
    expect(advanceTasks(tasks, [], chosen, start)).toEqual([true, false]);
    expect(advanceTasks(tasks, [], { ...chosen, commandCount: 4 }, start)).toEqual([true, true]);
  });

  it('ignore un geste fait avec un autre outil', () => {
    const { tasks } = step('biome');
    const now = { ...BASE, tool: 'biome' as const, commandCount: 1, undoLabel: 'coup de pinceau' };
    expect(advanceTasks(tasks, [], now, BASE)).toEqual([true, false]);
  });
});

describe('targetsOf', () => {
  it('montre la première tâche à faire, puis l’élément de l’étape', () => {
    const relief = step('relief');
    expect(targetsOf(relief, [false, false])).toEqual(['tool-relief']);
    expect(targetsOf(relief, [true, false])).toEqual(['map']);
    expect(targetsOf(step('ring-speed'), [true, false])).toEqual(['date', 'ring-speed']);
    expect(targetsOf(step('welcome'), [])).toEqual([]);
  });
});

describe('TUTORIAL_STEPS', () => {
  it('a des identifiants uniques', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ne tient aucune tâche pour faite tant que rien n’a bougé', () => {
    for (const s of TUTORIAL_STEPS) {
      const done = advanceTasks(s.tasks, [], BASE, BASE);
      expect(done.some(Boolean), s.id).toBe(false);
    }
  });
});

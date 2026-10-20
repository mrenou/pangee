import { describe, expect, it } from 'vitest';
import {
  buildCreature,
  creatureAtWorld,
  removeCreature,
  updateCreature,
  worldToRingLocal,
} from '@/edit/creatures';
import { DEFAULT_RING_CONFIG, type RingConfig } from '@/model/ring';
import type { Creature } from '@/model/world';

const cfg: RingConfig = {
  ...DEFAULT_RING_CONFIG,
  rings: {
    north: { id: 'north', omegaDegPerDay: 1 },
    equator: { id: 'equator', omegaDegPerDay: 0 },
    south: { id: 'south', omegaDegPerDay: 0 },
  },
  t0: 0,
};

// Un triangle dans l'anneau nord.
const dragon = buildCreature('d', 'dragon', 'north', [
  [0, 40],
  [20, 40],
  [10, 60],
])!;

describe('créatures', () => {
  it('refuse une trajectoire d un seul point', () => {
    expect(buildCreature('x', 'bird', 'north', [[0, 0]])).toBeUndefined();
  });

  it('se nomme d après son type et boucle par défaut', () => {
    expect(dragon).toMatchObject({ name: 'Dragon', loop: true, ringId: 'north' });
  });

  it('se sélectionne par sa trajectoire, segment de fermeture compris', () => {
    // Le segment (10, 60) → (0, 40) n'existe que parce que la trajectoire boucle.
    expect(creatureAtWorld(5, 50, [dragon], cfg, 0, 1)?.id).toBe('d');
    const open: Creature = { ...dragon, loop: false };
    expect(creatureAtWorld(5, 50, [open], cfg, 0, 1)).toBeUndefined();
  });

  it('se cherche là où son anneau l a emmenée', () => {
    // À t = 30, l'anneau nord a tourné de 30° : le segment du bas va de 30° à 50°.
    expect(creatureAtWorld(10, 40, [dragon], cfg, 30, 1)).toBeUndefined();
    expect(creatureAtWorld(40, 40, [dragon], cfg, 30, 1)?.id).toBe('d');
  });

  it('exprime un point monde dans le référentiel de son anneau', () => {
    expect(worldToRingLocal(40, 'north', cfg, 30)).toBeCloseTo(10);
  });

  it('se retouche et se supprime', () => {
    const [edited] = updateCreature([dragon], 'd', { kind: 'serpent', speedDegPerS: 5 });
    expect(edited).toMatchObject({ kind: 'serpent', speedDegPerS: 5 });
    expect(removeCreature([dragon], 'd')).toEqual([]);
  });
});

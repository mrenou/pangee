import { beforeEach, describe, expect, it } from 'vitest';
import { reassignToRings } from '@/edit/rings';
import { resetRoadIds } from '@/edit/roads';
import { DEFAULT_RING_CONFIG, removeCut, splitRing } from '@/model/ring';
import type { Creature, Place, Road } from '@/model/world';

beforeEach(() => resetRoadIds());

const place = (id: string, lat: number): Place => ({
  id,
  ringId: 'north',
  lon: 0,
  lat,
  name: id,
  kind: 'town',
  size: 2,
});

// Une route nord-sud de 70° à 40°, entièrement dans l'anneau nord.
const road: Road = {
  id: 'r',
  ringId: 'north',
  kind: 'road',
  points: [
    [0, 70],
    [0, 40],
  ],
};

const dragon: Creature = {
  id: 'd',
  name: 'Dragon',
  kind: 'dragon',
  ringId: 'equator',
  points: [
    [0, 10],
    [10, 20],
  ],
  speedDegPerS: 2,
  loop: true,
};

describe('réaffectation aux anneaux', () => {
  it('scinde à la nouvelle coupure les routes qui la franchissent', () => {
    const split = splitRing(DEFAULT_RING_CONFIG, 0, 60)!;
    const { roads } = reassignToRings({ places: [], roads: [road], creatures: [] }, split);
    expect(roads).toHaveLength(2);
    expect(roads.map((r) => r.ringId)).toEqual(['north', split.rings[1]!.id]);
    // Les deux moitiés se touchent exactement à la coupure.
    expect(roads[0]!.points.at(-1)).toEqual([0, 60]);
    expect(roads[1]!.points[0]).toEqual([0, 60]);
  });

  it('garde intacte une route qui ne franchit rien', () => {
    const { roads } = reassignToRings(
      { places: [], roads: [road], creatures: [] },
      DEFAULT_RING_CONFIG,
    );
    expect(roads).toEqual([road]);
  });

  it('range chaque lieu dans l anneau de sa latitude', () => {
    const split = splitRing(DEFAULT_RING_CONFIG, 0, 60)!;
    const { places } = reassignToRings(
      { places: [place('haut', 75), place('bas', 45)], roads: [], creatures: [] },
      split,
    );
    expect(places.map((p) => p.ringId)).toEqual(['north', split.rings[1]!.id]);
  });

  it('rattache une créature dont l anneau a disparu', () => {
    const merged = removeCut(DEFAULT_RING_CONFIG, 0)!; // l'équateur fusionne dans le nord
    const { creatures } = reassignToRings({ places: [], roads: [], creatures: [dragon] }, merged);
    expect(creatures[0]!.ringId).toBe('north');
  });
});

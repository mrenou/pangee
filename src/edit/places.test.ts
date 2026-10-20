import { describe, expect, it } from 'vitest';
import { movePlace, placeAtWorld, removePlace, updatePlace } from '@/edit/places';
import { DEFAULT_RING_CONFIG, type RingConfig } from '@/model/ring';
import type { Place } from '@/model/world';

// Coupures à +30 et -30 ; l'anneau nord tourne d'un degré par jour.
const cfg: RingConfig = {
  ...DEFAULT_RING_CONFIG,
  rings: {
    north: { id: 'north', omegaDegPerDay: 1 },
    equator: { id: 'equator', omegaDegPerDay: 0 },
    south: { id: 'south', omegaDegPerDay: 0 },
  },
  t0: 0,
};

const kerth: Place = {
  id: 'kerth',
  ringId: 'north',
  lon: 10,
  lat: 40,
  name: 'Kerth',
  kind: 'city',
  size: 4,
};

const aube: Place = {
  id: 'aube',
  ringId: 'equator',
  lon: 10,
  lat: 20,
  name: 'Aube',
  kind: 'village',
  size: 1,
  notes: 'Puits tari',
};

describe('lieu sous le curseur', () => {
  it('trouve le lieu là où le MJ le voit, anneau tourné', () => {
    // À t = 50, Kerth est affichée à 60° de longitude monde.
    expect(placeAtWorld(60, 40, [kerth, aube], cfg, 50, 1)?.id).toBe('kerth');
    expect(placeAtWorld(10, 40, [kerth, aube], cfg, 50, 1)).toBeUndefined();
  });

  it('prend le plus proche quand deux lieux sont à portée', () => {
    expect(placeAtWorld(10, 22, [kerth, aube], cfg, 0, 30)?.id).toBe('aube');
  });

  it('passe la couture du méridien ±180', () => {
    const edge: Place = { ...aube, id: 'edge', lon: 179.5 };
    expect(placeAtWorld(-179.5, 20, [edge], cfg, 0, 2)?.id).toBe('edge');
  });
});

describe('déplacement d un lieu', () => {
  it('recalcule l anneau depuis la nouvelle latitude', () => {
    const [moved] = movePlace([aube], 'aube', 12, 45, cfg);
    expect(moved).toMatchObject({ lon: 12, lat: 45, ringId: 'north' });
  });

  it('ramène la longitude dans le domaine', () => {
    const [moved] = movePlace([aube], 'aube', 190, 0, cfg);
    expect(moved?.lon).toBeCloseTo(-170);
  });

  it('ne touche pas aux autres lieux', () => {
    const next = movePlace([kerth, aube], 'aube', 0, 0, cfg);
    expect(next[0]).toBe(kerth);
  });
});

describe('retouche des champs', () => {
  it('modifie le nom, le type et la taille', () => {
    const [edited] = updatePlace([kerth], 'kerth', { name: 'Haute-Kerth', kind: 'ruin', size: 2 });
    expect(edited).toMatchObject({ name: 'Haute-Kerth', kind: 'ruin', size: 2, lat: 40 });
  });

  it('efface les notes vides plutôt que de stocker une chaîne vide', () => {
    const [edited] = updatePlace([aube], 'aube', { notes: '  ' });
    expect(edited).not.toHaveProperty('notes');
  });

  it('garde les notes quand on ne les retouche pas', () => {
    const [edited] = updatePlace([aube], 'aube', { name: 'Aube-la-Sèche' });
    expect(edited?.notes).toBe('Puits tari');
  });
});

describe('suppression', () => {
  it('retire le seul lieu visé', () => {
    expect(removePlace([kerth, aube], 'kerth')).toEqual([aube]);
  });
});

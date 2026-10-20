import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildRoads,
  insertCutPoints,
  interpolateAtLat,
  removeRoad,
  resetRoadIds,
  roadAtWorld,
  setRoadKind,
  snapToPlace,
  type Point,
} from '@/edit/roads';
import { DEFAULT_RING_CONFIG, ringOf, type RingConfig } from '@/model/ring';
import type { Place, Road } from '@/model/world';

const cfg: RingConfig = DEFAULT_RING_CONFIG; // coupures à +30 et -30

beforeEach(() => {
  resetRoadIds();
});

describe('interpolation à une latitude', () => {
  it('tombe exactement sur la latitude demandée', () => {
    const p = interpolateAtLat([0, 0], [10, 60], 30);
    expect(p[1]).toBe(30);
    expect(p[0]).toBeCloseTo(5);
  });

  it('prend le plus court chemin en longitude', () => {
    // De 170°E à 170°O : on passe par la couture, pas par l'autre bout. Le
    // domaine étant [-180, 180[, le méridien de la couture s'écrit -180.
    const p = interpolateAtLat([170, 0], [-170, 60], 30);
    expect(Math.abs(p[0])).toBeCloseTo(180);
  });

  it('ne divise pas par zéro sur un segment horizontal', () => {
    expect(interpolateAtLat([0, 30], [10, 30], 30)[1]).toBe(30);
  });
});

describe('insertion des points de coupure', () => {
  it('insère un point exactement à la latitude de coupure', () => {
    const dense = insertCutPoints(
      [
        [0, 10],
        [0, 50],
      ],
      cfg,
    );
    expect(dense).toHaveLength(3);
    expect(dense[1]![1]).toBe(cfg.cutNorthLat);
  });

  it('insère les deux coupures dans l ordre du parcours', () => {
    const dense = insertCutPoints(
      [
        [0, -50],
        [0, 50],
      ],
      cfg,
    );
    const lats = dense.map((p) => p[1]);
    expect(lats).toEqual([-50, -30, 30, 50]);
  });

  it('les insère en sens inverse quand on descend', () => {
    const dense = insertCutPoints(
      [
        [0, 50],
        [0, -50],
      ],
      cfg,
    );
    expect(dense.map((p) => p[1])).toEqual([50, 30, -30, -50]);
  });

  it('ne touche pas une ligne qui reste dans son anneau', () => {
    const points: Point[] = [
      [0, 5],
      [10, 10],
      [20, 0],
    ];
    expect(insertCutPoints(points, cfg)).toEqual(points);
  });
});

describe('scission des routes', () => {
  it('laisse entière une route qui ne franchit rien', () => {
    const roads = buildRoads(
      [
        [0, 0],
        [10, 5],
        [20, 10],
      ],
      cfg,
    );
    expect(roads).toHaveLength(1);
    expect(roads[0]!.ringId).toBe('equator');
  });

  it('coupe en deux une route qui franchit une coupure', () => {
    const roads = buildRoads(
      [
        [0, 10],
        [0, 50],
      ],
      cfg,
    );
    expect(roads).toHaveLength(2);
    expect(roads[0]!.ringId).toBe('equator');
    expect(roads[1]!.ringId).toBe('north');
  });

  it('coupe exactement à la latitude de coupure', () => {
    const roads = buildRoads(
      [
        [0, 10],
        [0, 50],
      ],
      cfg,
    );
    const south = roads[0]!;
    const north = roads[1]!;
    expect(south.points[south.points.length - 1]![1]).toBe(cfg.cutNorthLat);
    expect(north.points[0]![1]).toBe(cfg.cutNorthLat);
  });

  it('fait se toucher les deux moitiés à la frontière', () => {
    const roads = buildRoads(
      [
        [12, 10],
        [40, 50],
      ],
      cfg,
    );
    const end = roads[0]!.points[roads[0]!.points.length - 1]!;
    const start = roads[1]!.points[0]!;
    expect(start).toEqual(end);
  });

  it('produit trois routes quand on traverse tout le monde du sud au nord', () => {
    const roads = buildRoads(
      [
        [0, -60],
        [0, 60],
      ],
      cfg,
    );
    expect(roads.map((r) => r.ringId)).toEqual(['south', 'equator', 'north']);
  });

  it('donne à chaque portion l anneau de son propre tracé', () => {
    for (const road of buildRoads(
      [
        [0, -60],
        [0, 60],
      ],
      cfg,
    )) {
      // Le milieu de chaque portion doit bien appartenir à l'anneau annoncé.
      const middle = road.points[Math.floor(road.points.length / 2)]!;
      const inside = road.points.find((p) => p[1] !== cfg.cutNorthLat && p[1] !== cfg.cutSouthLat);
      expect(ringOf(inside ? inside[1] : middle[1], cfg)).toBe(road.ringId);
    }
  });

  it('donne un identifiant distinct à chaque portion', () => {
    const roads = buildRoads(
      [
        [0, -60],
        [0, 60],
      ],
      cfg,
    );
    expect(new Set(roads.map((r) => r.id)).size).toBe(roads.length);
  });

  it('refuse de faire une route d un seul point', () => {
    expect(buildRoads([[0, 0]], cfg)).toEqual([]);
  });

  it('conserve le type demandé', () => {
    expect(
      buildRoads(
        [
          [0, 0],
          [5, 5],
        ],
        cfg,
        'sea-route',
      )[0]!.kind,
    ).toBe('sea-route');
  });

  it('gère une route qui franchit à la fois une coupure et le méridien ±180', () => {
    const roads = buildRoads(
      [
        [175, 10],
        [-175, 50],
      ],
      cfg,
    );
    expect(roads).toHaveLength(2);
    const seam = roads[0]!.points[roads[0]!.points.length - 1]!;
    expect(seam[1]).toBe(cfg.cutNorthLat);
    // L'interpolation passe par la couture : la longitude reste près de 180.
    expect(Math.abs(Math.abs(seam[0]) - 180)).toBeLessThan(5);
  });
});

describe('magnétisme', () => {
  const places: readonly Place[] = [
    { id: 'a', ringId: 'equator', lon: 10, lat: 5, name: 'Alpha', kind: 'city', size: 4 },
    { id: 'b', ringId: 'equator', lon: -170, lat: 0, name: 'Beta', kind: 'town', size: 2 },
  ];

  it('accroche le lieu le plus proche dans la limite', () => {
    expect(snapToPlace(10.2, 5.1, places, 1)?.id).toBe('a');
  });

  it('n accroche rien au-delà de la limite', () => {
    expect(snapToPlace(50, 50, places, 1)).toBeUndefined();
  });

  it('accroche par-delà le méridien ±180', () => {
    expect(snapToPlace(175, 0, places, 20)?.id).toBe('b');
  });
});

describe('route sous le curseur', () => {
  const turning: RingConfig = {
    ...DEFAULT_RING_CONFIG,
    rings: {
      north: { id: 'north', omegaDegPerDay: 1 },
      equator: { id: 'equator', omegaDegPerDay: 0 },
      south: { id: 'south', omegaDegPerDay: 0 },
    },
    t0: 0,
  };
  // Une route nord, de (0, 40) à (10, 40), et une route équatoriale verticale à x = 20.
  const north: Road = {
    id: 'n',
    ringId: 'north',
    kind: 'road',
    points: [
      [0, 40],
      [10, 40],
    ],
  };
  const equator: Road = {
    id: 'e',
    ringId: 'equator',
    kind: 'path',
    points: [
      [20, 0],
      [20, 20],
    ],
  };

  it('trouve une route par le milieu d un segment, pas seulement par ses sommets', () => {
    expect(roadAtWorld(5, 40.5, [north, equator], turning, 0, 1)?.id).toBe('n');
    expect(roadAtWorld(20.3, 10, [north, equator], turning, 0, 1)?.id).toBe('e');
  });

  it('cherche la route là où l anneau l a emmenée', () => {
    // À t = 30, la route nord est affichée de 30° à 40°.
    expect(roadAtWorld(5, 40, [north], turning, 30, 1)).toBeUndefined();
    expect(roadAtWorld(35, 40, [north], turning, 30, 1)?.id).toBe('n');
  });

  it('ignore une route hors de portée', () => {
    expect(roadAtWorld(5, 45, [north], turning, 0, 1)).toBeUndefined();
  });

  it('passe la couture du méridien ±180', () => {
    const seam: Road = {
      id: 's',
      ringId: 'equator',
      kind: 'road',
      points: [
        [175, 0],
        [-175, 0],
      ],
    };
    expect(roadAtWorld(179.9, 0.2, [seam], turning, 0, 1)?.id).toBe('s');
  });
});

describe('retouche des routes', () => {
  const a: Road = {
    id: 'a',
    ringId: 'equator',
    kind: 'road',
    points: [
      [0, 0],
      [1, 1],
    ],
  };
  const b: Road = {
    id: 'b',
    ringId: 'equator',
    kind: 'road',
    points: [
      [2, 2],
      [3, 3],
    ],
  };

  it('change le type de la seule route visée', () => {
    const [first, second] = setRoadKind([a, b], 'b', 'sea-route');
    expect(first).toBe(a);
    expect(second?.kind).toBe('sea-route');
  });

  it('supprime la seule route visée', () => {
    expect(removeRoad([a, b], 'a')).toEqual([b]);
  });
});

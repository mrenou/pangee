import { beforeEach, describe, expect, it } from 'vitest';
import { idx } from '@/model/coords';
import { DEFAULT_RING_CONFIG, type RingConfig } from '@/model/ring';
import type { RasterSize } from '@/model/world';
import {
  assembleHeightWorld,
  computeHydro,
  resetHydroBuffers,
  rowShiftCells,
  DRY,
  NO_FLOW,
  type HydroState,
} from '@/hydro';

beforeEach(() => {
  resetHydroBuffers();
});

/** Construit une grille depuis un dessin : une ligne de texte par ligne. */
function grid(rows: readonly (readonly number[])[]): {
  size: RasterSize;
  height: Float32Array;
} {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[y * width + x] = rows[y]![x]!;
  }
  return { size: { width, height }, height: data };
}

function run(
  rows: readonly (readonly number[])[],
  seaLevelM = -1000,
  rainPerCell = 1,
): HydroState & { size: RasterSize } {
  const { size, height } = grid(rows);
  return computeHydro({ size, heightWorld: height, seaLevelM, rainPerCell });
}

describe('cuvette fermée', () => {
  // Une cuvette entourée d'un rebord à 50, avec un col à 30 au nord.
  //   50 50 30 50 50 50 50 50
  //   50 10 10 10 50 50 50 50
  //   50 10  5 10 50 50 50 50
  //   50 10 10 10 50 50 50 50
  //   50 50 50 50 50 50 50 50
  // Attendu : le lac monte exactement à la cote du col, 30.
  const rows = [
    [50, 50, 30, 50, 50, 50, 50, 50],
    [50, 10, 10, 10, 50, 50, 50, 50],
    [50, 10, 5, 10, 50, 50, 50, 50],
    [50, 10, 10, 10, 50, 50, 50, 50],
    [50, 50, 50, 50, 50, 50, 50, 50],
  ];

  it('remplit la cuvette jusqu à la cote de débordement, pas au-delà', () => {
    const state = run(rows);
    const w = state.size.width;
    // Le fond, à 5, est noyé sous 30.
    expect(state.filled[idx(2, 2, w)]).toBeCloseTo(30, 2);
    // Le rebord à 50 n'est pas touché.
    expect(state.filled[idx(0, 0, w)]).toBeCloseTo(50, 2);
    // Le col lui-même reste à sa cote.
    expect(state.filled[idx(2, 0, w)]).toBeCloseTo(30, 2);
  });

  it('constate un lac au niveau du col', () => {
    const state = run(rows);
    const w = state.size.width;
    expect(state.lakes).toHaveLength(1);
    expect(state.lakes[0]!.levelM).toBeCloseTo(30, 2);
    expect(state.lakeId[idx(2, 2, w)]).toBe(state.lakes[0]!.id);
    expect(state.waterLevel[idx(2, 2, w)]).toBeCloseTo(30, 2);
    // Une cellule de rebord reste sèche.
    expect(state.waterLevel[idx(6, 2, w)]).toBe(DRY);
  });

  it('compte les cellules noyées et pas les autres', () => {
    const state = run(rows);
    // Les huit cellules à 10 et le fond à 5.
    expect(state.lakes[0]!.cellCount).toBe(9);
  });
});

describe('deux cuvettes emboîtées', () => {
  // Une vallée verticale murée, qui descend vers le bord sud. Deux cuvettes
  // séparées par un col, chacune avec sa propre cote de débordement. Elles font
  // trois cellules de haut : une cuvette d'une seule cellule est écartée comme
  // artefact du bruit.
  //   99  99  99  99      le mur ferme la vallée, x wrappe donc 0 et 3 se touchent
  //   99  10  99  99  \
  //   99  10  99  99   >  cuvette A, fond à 10
  //   99  10  99  99  /
  //   99  40  99  99      col A → B, à 40
  //   99   0  99  99  \
  //   99   0  99  99   >  cuvette B, fond à 0
  //   99   0  99  99  /
  //   99  30  99  99      col B → sortie, à 30
  //   99   5  99  99
  //    0   0   0   0      bord sud : l'exutoire du monde
  // Attendu : B monte à 30, A monte à 40.
  const rows = [
    [99, 99, 99, 99],
    [99, 10, 99, 99],
    [99, 10, 99, 99],
    [99, 10, 99, 99],
    [99, 40, 99, 99],
    [99, 0, 99, 99],
    [99, 0, 99, 99],
    [99, 0, 99, 99],
    [99, 30, 99, 99],
    [99, 5, 99, 99],
    [0, 0, 0, 0],
  ];

  it('donne à chaque cuvette son propre niveau de débordement', () => {
    const state = run(rows);
    const w = state.size.width;
    expect(state.filled[idx(1, 6, w)]).toBeCloseTo(30, 1);
    expect(state.filled[idx(1, 2, w)]).toBeCloseTo(40, 1);
  });

  it('les traite comme deux lacs distincts', () => {
    const state = run(rows);
    const w = state.size.width;
    expect(state.lakes.length).toBe(2);
    expect(state.lakeId[idx(1, 2, w)]).not.toBe(state.lakeId[idx(1, 6, w)]);
  });

  it('ne noie pas les cols eux-mêmes', () => {
    const state = run(rows);
    const w = state.size.width;
    expect(state.lakeId[idx(1, 4, w)]).toBe(0);
    expect(state.lakeId[idx(1, 8, w)]).toBe(0);
  });
});

describe('pente uniforme', () => {
  // Le relief descend vers le sud. Chaque ligne draine celles du nord.
  const rows = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, () => 80 - y * 10));

  it('fait croître l accumulation vers l aval', () => {
    const state = run(rows);
    const w = state.size.width;
    const north = state.flowAcc[idx(3, 0, w)]!;
    const middle = state.flowAcc[idx(3, 3, w)]!;
    const south = state.flowAcc[idx(3, 6, w)]!;
    expect(north).toBe(1);
    expect(middle).toBeGreaterThan(north);
    expect(south).toBeGreaterThan(middle);
  });

  it('conserve la pluie : le total sortant vaut le total tombé', () => {
    const state = run(rows);
    const w = state.size.width;
    let leaving = 0;
    for (let x = 0; x < w; x += 1) leaving += state.flowAcc[idx(x, 7, w)]!;
    expect(leaving).toBeCloseTo(8 * 8, 5);
  });

  it('donne une direction à toute cellule non marine', () => {
    const state = run(rows);
    for (let i = 0; i < state.flowDir.length; i += 1) {
      if (state.isOcean[i] === 0) expect(state.flowDir[i]).not.toBe(NO_FLOW);
    }
  });
});

describe('plat parfait entre deux pentes', () => {
  // Un plateau horizontal au milieu : sans le epsilon, aucune cellule du plat
  // n'aurait de direction d'écoulement.
  const rows = [
    [50, 50, 50, 50, 50, 50, 50, 50],
    [20, 20, 20, 20, 20, 20, 20, 20],
    [20, 20, 20, 20, 20, 20, 20, 20],
    [20, 20, 20, 20, 20, 20, 20, 20],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ];

  it('résout l écoulement sur tout le plat', () => {
    const state = run(rows);
    for (let i = 0; i < state.flowDir.length; i += 1) {
      if (state.isOcean[i] === 0) expect(state.flowDir[i]).not.toBe(NO_FLOW);
    }
  });

  it('ne crée pas de lac sur un plat qui s écoule', () => {
    expect(run(rows).lakes).toHaveLength(0);
  });
});

describe('wrap est-ouest', () => {
  // Une vallée coupée par le méridien ±180 : elle occupe la dernière et la
  // première colonne. Sur un plan, ce serait deux vallées.
  //   60 60 60 60 60 60
  //   10 60 60 60 60 10
  //   10 60 60 60 60 10
  //    5 60 60 60 60  5
  const rows = [
    [60, 60, 60, 60, 60, 60],
    [10, 60, 60, 60, 60, 10],
    [10, 60, 60, 60, 60, 10],
    [5, 60, 60, 60, 60, 5],
  ];

  it('traite les deux bords comme voisins', () => {
    const state = run(rows);
    const w = state.size.width;
    // L'eau de la colonne 0 et celle de la colonne 5 se rejoignent au sud.
    const acc0 = state.flowAcc[idx(0, 3, w)]!;
    const acc5 = state.flowAcc[idx(5, 3, w)]!;
    expect(acc0 + acc5).toBeGreaterThan(6);
  });

  it('ne laisse pas de couture dans le relief rempli', () => {
    const state = run(rows);
    const w = state.size.width;
    for (let y = 0; y < 4; y += 1) {
      expect(state.filled[idx(0, y, w)]).toBeCloseTo(state.filled[idx(w - 1, y, w)]!, 2);
    }
  });
});

describe('océan', () => {
  const rows = Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => (x < 4 ? -500 : 100 + y * 10)),
  );

  it('reconnaît la mer sous le niveau réglé', () => {
    const state = run(rows, 0);
    const w = state.size.width;
    expect(state.isOcean[idx(1, 1, w)]).toBe(1);
    expect(state.isOcean[idx(6, 1, w)]).toBe(0);
  });

  it('met la surface de la mer au niveau réglé', () => {
    const state = run(rows, 0);
    const w = state.size.width;
    expect(state.waterLevel[idx(1, 1, w)]).toBeCloseTo(0, 5);
  });

  it('suit le niveau de la mer quand on le relève', () => {
    const w = 8;
    const high = run(rows, 150);
    // À 150 m, les premières lignes de terre passent sous l'eau.
    expect(high.isOcean[idx(5, 0, w)]).toBe(1);
    expect(high.isOcean[idx(5, 7, w)]).toBe(0);
  });
});

describe('barrage créé par le glissement d un anneau', () => {
  // Le test central de Pangée : aucune ligne de code ne parle de barrage, le
  // lac doit naître du seul décalage des bandes.
  const cfg: RingConfig = {
    ...DEFAULT_RING_CONFIG,
    cutNorthLat: 30,
    cutSouthLat: -30,
    rings: {
      north: { id: 'north', omegaDegPerDay: 0 },
      equator: { id: 'equator', omegaDegPerDay: 90 },
      south: { id: 'south', omegaDegPerDay: 0 },
    },
    t0: 0,
  };

  // 8 colonnes, 4 lignes. Les lignes 1 et 2 sont équatoriales (|lat| < 30),
  // les lignes 0 et 3 sont polaires.
  // Une vallée descend vers l'est sur la bande équatoriale, et un massif
  // occupe l'ouest de cette même bande. Décaler la bande d'un quart de tour
  // amène le massif en travers de la vallée.
  // Une vallée équatoriale qui descend vers l'ouest et trouve sa sortie dans le
  // bord sud, sous la colonne 1. Les lignes 0 et 3 sont polaires, donc
  // immobiles ; les lignes 1 et 2 sont équatoriales et glissent.
  //   99 99 99 99 99 99 99 99 99 99 99 99
  //   99  5 10 20 30 40 50 99 99 99 99 99
  //   99  5 10 20 30 40 50 99 99 99 99 99
  //   99  0 99 99 99 99 99 99 99 99 99 99   <- l'exutoire du monde
  // Après un quart de tour vers l'est, la vallée n'est plus au-dessus de sa
  // sortie : elle n'a plus d'issue et se remplit.
  //
  // La sortie est volontairement loin de la vallée décalée : le remplissage
  // travaille en 8-connexité, une simple diagonale suffirait à rouvrir
  // l'exutoire et le test ne prouverait plus rien.
  const rows = [
    [99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99],
    [99, 5, 10, 20, 30, 40, 50, 99, 99, 99, 99, 99],
    [99, 5, 10, 20, 30, 40, 50, 99, 99, 99, 99, 99],
    [99, 0, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99],
  ];
  const size: RasterSize = { width: 12, height: 4 };

  function hydroAt(tDays: number): HydroState {
    const local = new Float32Array(size.width * size.height);
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) local[y * size.width + x] = rows[y]![x]!;
    }
    const world = assembleHeightWorld(size, local, cfg, tDays);
    return computeHydro({ size, heightWorld: world, seaLevelM: -1000, rainPerCell: 1 });
  }

  it('décale bien la bande équatoriale et elle seule', () => {
    // 90°/jour pendant 1 jour = un quart de tour = 3 cellules sur 12.
    expect(rowShiftCells(0, cfg, 1, 12)).toBe(3);
    expect(rowShiftCells(60, cfg, 1, 12)).toBe(0);
    expect(rowShiftCells(-60, cfg, 1, 12)).toBe(0);
  });

  it('ne trouve aucun lac dans le monde d avant le Cataclysme', () => {
    expect(hydroAt(cfg.t0).lakes).toHaveLength(0);
  });

  it('fait naître un lac une fois la bande décalée', () => {
    // Un jour à 90°/jour : la bande glisse d'un quart de tour, le fond de la
    // vallée quitte l'exutoire et l'eau n'a plus d'issue.
    const after = hydroAt(1);
    expect(after.lakes.length).toBeGreaterThan(0);

    // Le fond de la vallée, à 5, est noyé.
    const w = size.width;
    const lake = after.lakes[0]!;
    expect(after.lakeId[idx(4, 1, w)]).toBe(lake.id);
    expect(lake.levelM).toBeGreaterThan(50);
    expect(lake.depthM).toBeGreaterThan(15);
  });

  it('est réversible : revenir à t0 fait disparaître le lac', () => {
    hydroAt(1);
    expect(hydroAt(cfg.t0).lakes).toHaveLength(0);
  });
});

describe('assemblage', () => {
  const size: RasterSize = { width: 8, height: 4 };
  const cfg: RingConfig = {
    ...DEFAULT_RING_CONFIG,
    rings: {
      north: { id: 'north', omegaDegPerDay: 45 },
      equator: { id: 'equator', omegaDegPerDay: 0 },
      south: { id: 'south', omegaDegPerDay: -45 },
    },
  };

  function local(): Float32Array {
    const data = new Float32Array(size.width * size.height);
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) data[y * size.width + x] = x;
    }
    return data;
  }

  it('ne décale rien à t0', () => {
    const world = assembleHeightWorld(size, local(), cfg, cfg.t0);
    expect(Array.from(world)).toEqual(Array.from(local()));
  });

  it('décale chaque anneau dans son sens', () => {
    // 45°/jour pendant 1 jour = un huitième de tour = 1 cellule.
    const world = assembleHeightWorld(size, local(), cfg, 1);
    const w = size.width;
    // Nord : la colonne 0 affiche ce qui était en colonne -1, donc 7.
    expect(world[idx(0, 0, w)]).toBe(7);
    // Équateur immobile.
    expect(world[idx(0, 1, w)]).toBe(0);
    // Sud : décalage inverse, la colonne 0 affiche la colonne 1.
    expect(world[idx(0, 3, w)]).toBe(1);
  });

  it('wrappe au lieu de perdre des colonnes', () => {
    const world = assembleHeightWorld(size, local(), cfg, 1);
    const w = size.width;
    const values = new Set<number>();
    for (let x = 0; x < w; x += 1) values.add(world[idx(x, 0, w)]!);
    expect(values.size).toBe(w);
  });
});

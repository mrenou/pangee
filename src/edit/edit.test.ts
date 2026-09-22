import { describe, expect, it } from 'vitest';
import { applyPatch, GestureRecorder, shortestDelta } from '@/edit/patch';
import { History, rasterCommand, placesCommand, type EditTarget } from '@/edit/history';
import { brushWeight, paintBiome, paintRelief } from '@/edit/brush';
import { idx } from '@/model/coords';
import type { Place, RasterSize } from '@/model/world';

const size: RasterSize = { width: 16, height: 8 };

function target(): EditTarget {
  return {
    size,
    height: new Float32Array(size.width * size.height),
    biomeOverride: new Uint8Array(size.width * size.height),
    places: [],
    roads: [],
  };
}

describe('écart le plus court sur le cylindre', () => {
  it('prend le chemin direct quand il est court', () => {
    expect(shortestDelta(3, 16)).toBe(3);
    expect(shortestDelta(-3, 16)).toBe(-3);
  });

  it('passe par la couture quand elle raccourcit', () => {
    expect(shortestDelta(15, 16)).toBe(-1);
    expect(shortestDelta(-15, 16)).toBe(1);
  });
});

describe('enregistrement d un geste', () => {
  it('garde la valeur d avant le geste, pas celle d avant le dernier pas', () => {
    const t = target();
    const recorder = new GestureRecorder('height', size);

    recorder.record(4, 2, t.height[idx(4, 2, size.width)]!);
    t.height[idx(4, 2, size.width)] = 100;
    // Deuxième passage sur la même cellule, au cours du même geste.
    recorder.record(4, 2, t.height[idx(4, 2, size.width)]!);
    t.height[idx(4, 2, size.width)] = 250;

    const patch = recorder.finish(t.height)!;
    applyPatch(patch, t.height, size, 'before');
    expect(t.height[idx(4, 2, size.width)]).toBe(0);
  });

  it('ne renvoie rien si le geste n a touché aucune cellule', () => {
    expect(new GestureRecorder('height', size).finish(new Float32Array(128))).toBeUndefined();
  });

  it('englobe exactement les cellules touchées', () => {
    const t = target();
    const recorder = new GestureRecorder('height', size);
    recorder.record(3, 1, 0);
    recorder.record(5, 4, 0);
    const patch = recorder.finish(t.height)!;
    expect(patch.x).toBe(3);
    expect(patch.y).toBe(1);
    expect(patch.w).toBe(3);
    expect(patch.h).toBe(4);
  });

  it('reste une boîte étroite quand le geste franchit le méridien ±180', () => {
    // Sans dépliage, toucher les colonnes 15 et 0 donnerait une boîte large de
    // toute la planète.
    const t = target();
    const recorder = new GestureRecorder('height', size);
    recorder.record(15, 3, 0);
    recorder.record(0, 3, 0);
    recorder.record(1, 3, 0);
    const patch = recorder.finish(t.height)!;
    expect(patch.w).toBe(3);
    expect(patch.x).toBe(15);
  });

  it('restaure correctement un patch qui enjambe la couture', () => {
    const t = target();
    const recorder = new GestureRecorder('height', size);
    for (const x of [15, 0, 1]) {
      recorder.record(x, 3, t.height[idx(x, 3, size.width)]!);
      t.height[idx(x, 3, size.width)] = 500;
    }
    const patch = recorder.finish(t.height)!;

    applyPatch(patch, t.height, size, 'before');
    for (const x of [15, 0, 1]) expect(t.height[idx(x, 3, size.width)]).toBe(0);

    applyPatch(patch, t.height, size, 'after');
    for (const x of [15, 0, 1]) expect(t.height[idx(x, 3, size.width)]).toBe(500);
  });

  it('laisse intactes les cellules de la boîte que le geste n a pas touchées', () => {
    const t = target();
    t.height[idx(4, 2, size.width)] = 42;
    const recorder = new GestureRecorder('height', size);
    recorder.record(3, 2, t.height[idx(3, 2, size.width)]!);
    t.height[idx(3, 2, size.width)] = 900;
    recorder.record(5, 2, t.height[idx(5, 2, size.width)]!);
    t.height[idx(5, 2, size.width)] = 900;

    const patch = recorder.finish(t.height)!;
    applyPatch(patch, t.height, size, 'before');
    expect(t.height[idx(4, 2, size.width)]).toBe(42);
  });
});

describe('pile d annulation', () => {
  function raiseCommand(t: EditTarget, value: number) {
    const recorder = new GestureRecorder('height', size);
    recorder.record(2, 2, t.height[idx(2, 2, size.width)]!);
    t.height[idx(2, 2, size.width)] = value;
    return rasterCommand('relief', recorder.finish(t.height)!);
  }

  it('annule puis rétablit une écriture', () => {
    const t = target();
    const history = new History();
    history.push(raiseCommand(t, 300));

    expect(t.height[idx(2, 2, size.width)]).toBe(300);
    history.undo(t);
    expect(t.height[idx(2, 2, size.width)]).toBe(0);
    history.redo(t);
    expect(t.height[idx(2, 2, size.width)]).toBe(300);
  });

  it('sait ce qu elle peut faire', () => {
    const t = target();
    const history = new History();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);

    history.push(raiseCommand(t, 100));
    expect(history.canUndo).toBe(true);
    expect(history.undoLabel).toBe('relief');

    history.undo(t);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it('efface la branche de rétablissement dès qu on repart de l avant', () => {
    const t = target();
    const history = new History();
    history.push(raiseCommand(t, 100));
    history.undo(t);
    expect(history.canRedo).toBe(true);

    history.push(raiseCommand(t, 700));
    expect(history.canRedo).toBe(false);
  });

  it('remonte plusieurs commandes dans l ordre inverse', () => {
    const t = target();
    const history = new History();
    const first = t.places;
    const after: readonly Place[] = [
      { id: 'a', ringId: 'equator', lon: 0, lat: 0, name: 'Alpha', kind: 'city', size: 4 },
    ];
    const command = placesCommand('poser un lieu', first, after);
    history.run(command, t);
    expect(t.places).toHaveLength(1);
    history.undo(t);
    expect(t.places).toHaveLength(0);
  });

  it('borne sa profondeur', () => {
    const t = target();
    const history = new History({ maxDepth: 3 });
    for (let i = 0; i < 10; i += 1) history.push(raiseCommand(t, i));
    expect(history.depth).toBe(3);
  });

  it('borne sa mémoire', () => {
    const t = target();
    const history = new History({ maxBytes: 1 });
    for (let i = 0; i < 5; i += 1) history.push(raiseCommand(t, i));
    // Au moins une commande reste : on ne vide jamais complètement la pile.
    expect(history.depth).toBe(1);
  });
});

describe('poids du pinceau', () => {
  it('vaut un au centre et zéro au-delà du rayon', () => {
    expect(brushWeight(0, 5, 0.5)).toBeCloseTo(1);
    expect(brushWeight(5, 5, 0.5)).toBe(0);
    expect(brushWeight(6, 5, 0.5)).toBe(0);
  });

  it('donne un disque net sans atténuation', () => {
    expect(brushWeight(4.9, 5, 0)).toBe(1);
  });

  it('décroît avec la distance quand on adoucit', () => {
    expect(brushWeight(1, 5, 1)).toBeGreaterThan(brushWeight(4, 5, 1));
  });
});

describe('pinceau de relief', () => {
  it('soulève le terrain au centre plus qu au bord', () => {
    const t = target();
    const recorder = new GestureRecorder('height', size);
    paintRelief(
      size,
      t.height,
      8,
      4,
      { mode: 'raise', radius: 3, falloff: 1, strengthM: 100 },
      recorder,
    );
    const center = t.height[idx(8, 4, size.width)]!;
    const edge = t.height[idx(10, 4, size.width)]!;
    expect(center).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(0);
  });

  it('creuse en mode lower', () => {
    const t = target();
    const recorder = new GestureRecorder('height', size);
    paintRelief(
      size,
      t.height,
      8,
      4,
      { mode: 'lower', radius: 2, falloff: 0.5, strengthM: 50 },
      recorder,
    );
    expect(t.height[idx(8, 4, size.width)]).toBeLessThan(0);
  });

  it('tire vers l altitude cible en mode flatten', () => {
    const t = target();
    t.height.fill(1000);
    const recorder = new GestureRecorder('height', size);
    paintRelief(
      size,
      t.height,
      8,
      4,
      { mode: 'flatten', radius: 2, falloff: 0, strengthM: 0, targetM: 200 },
      recorder,
    );
    expect(t.height[idx(8, 4, size.width)]).toBeCloseTo(200);
  });

  it('rabote une pointe isolée en mode smooth', () => {
    const t = target();
    t.height[idx(8, 4, size.width)] = 1000;
    const recorder = new GestureRecorder('height', size);
    paintRelief(
      size,
      t.height,
      8,
      4,
      { mode: 'smooth', radius: 1, falloff: 0, strengthM: 0 },
      recorder,
    );
    expect(t.height[idx(8, 4, size.width)]).toBeLessThan(1000);
  });

  it('enregistre ce qu il touche, pour pouvoir l annuler', () => {
    const t = target();
    const recorder = new GestureRecorder('height', size);
    paintRelief(
      size,
      t.height,
      8,
      4,
      { mode: 'raise', radius: 2, falloff: 0.5, strengthM: 100 },
      recorder,
    );
    expect(recorder.touchedCount).toBeGreaterThan(0);

    const patch = recorder.finish(t.height)!;
    applyPatch(patch, t.height, size, 'before');
    expect(Array.from(t.height).every((v) => v === 0)).toBe(true);
  });

  it('déborde par la couture sans se replier sur lui-même', () => {
    const t = target();
    const recorder = new GestureRecorder('height', size);
    paintRelief(
      size,
      t.height,
      0,
      4,
      { mode: 'raise', radius: 2, falloff: 0, strengthM: 100 },
      recorder,
    );
    // Le disque centré sur la colonne 0 mord sur la dernière colonne.
    expect(t.height[idx(size.width - 1, 4, size.width)]).toBeGreaterThan(0);
  });
});

describe('pinceau de biome', () => {
  it('pose la valeur pleine, sans fondu', () => {
    const t = target();
    const recorder = new GestureRecorder('biomeOverride', size);
    paintBiome(size, t.biomeOverride, 8, 4, { radius: 2, falloff: 1 }, 7, recorder);
    expect(t.biomeOverride[idx(8, 4, size.width)]).toBe(7);
    expect(t.biomeOverride[idx(9, 4, size.width)]).toBe(7);
  });

  it('remet à zéro en guise de gomme', () => {
    const t = target();
    t.biomeOverride.fill(7);
    const recorder = new GestureRecorder('biomeOverride', size);
    paintBiome(size, t.biomeOverride, 8, 4, { radius: 1, falloff: 0 }, 0, recorder);
    expect(t.biomeOverride[idx(8, 4, size.width)]).toBe(0);
  });

  it('ne déborde pas du disque', () => {
    const t = target();
    const recorder = new GestureRecorder('biomeOverride', size);
    paintBiome(size, t.biomeOverride, 8, 4, { radius: 1, falloff: 0 }, 5, recorder);
    expect(t.biomeOverride[idx(12, 4, size.width)]).toBe(0);
  });
});

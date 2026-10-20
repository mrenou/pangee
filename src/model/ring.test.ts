import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RING_CONFIG,
  MAX_RINGS,
  moveCut,
  removeCut,
  ringBounds,
  ringById,
  ringOf,
  splitRing,
  updateRing,
  validateRingConfig,
  type RingConfig,
} from '@/model/ring';

const cfg: RingConfig = DEFAULT_RING_CONFIG; // coupures à +30 et -30

describe('ringOf', () => {
  it('découpe la planète en trois bandes par défaut', () => {
    expect(ringOf(60, cfg)).toBe('north');
    expect(ringOf(0, cfg)).toBe('equator');
    expect(ringOf(-60, cfg)).toBe('south');
  });

  it('range la latitude de coupure elle-même du côté sud', () => {
    // Une seule règle pour toutes les coupures, la même que dans le shader.
    expect(ringOf(30, cfg)).toBe('equator');
    expect(ringOf(30 + 1e-9, cfg)).toBe('north');
    expect(ringOf(-30, cfg)).toBe('south');
    expect(ringOf(-30 + 1e-9, cfg)).toBe('equator');
  });

  it('couvre les pôles', () => {
    expect(ringOf(90, cfg)).toBe('north');
    expect(ringOf(-90, cfg)).toBe('south');
  });

  it('accepte un seul anneau, qui couvre toute la planète', () => {
    const single: RingConfig = { rings: [cfg.rings[0]!], cutsLat: [], t0: 0 };
    expect(ringOf(-80, single)).toBe('north');
    expect(validateRingConfig(single)).toEqual([]);
  });
});

describe('validateRingConfig', () => {
  it('accepte la configuration par défaut', () => {
    expect(validateRingConfig(cfg)).toEqual([]);
  });

  it('refuse des coupures inversées ou confondues', () => {
    expect(validateRingConfig({ ...cfg, cutsLat: [-40, 30] })).toContain('cuts-out-of-order');
    expect(validateRingConfig({ ...cfg, cutsLat: [10, 10] })).toContain('cuts-out-of-order');
  });

  it('refuse une coupure au pôle, qui viderait un anneau', () => {
    expect(validateRingConfig({ ...cfg, cutsLat: [90, -30] })).toContain('cut-out-of-range');
  });

  it('exige une coupure de moins que d anneaux', () => {
    expect(validateRingConfig({ ...cfg, cutsLat: [30] })).toContain('cut-count');
  });

  it('refuse deux anneaux de même identifiant', () => {
    const twins: RingConfig = { ...cfg, rings: [cfg.rings[0]!, cfg.rings[0]!, cfg.rings[2]!] };
    expect(validateRingConfig(twins)).toContain('duplicate-id');
  });

  it('refuse une vitesse non finie', () => {
    expect(validateRingConfig(updateRing(cfg, 'north', { omegaDegPerDay: Number.NaN }))).toContain(
      'omega-not-finite',
    );
  });
});

describe('scission d un anneau', () => {
  it('coupe un anneau en deux, la moitié sud héritant de sa vitesse', () => {
    const split = splitRing(cfg, 0, 60)!;
    expect(split.cutsLat).toEqual([60, 30, -30]);
    expect(split.rings.map((r) => r.id)).toEqual(['north', 'ring-4', 'equator', 'south']);
    expect(split.rings[1]!.omegaDegPerDay).toBe(cfg.rings[0]!.omegaDegPerDay);
    expect(validateRingConfig(split)).toEqual([]);
    // Les lieux au nord de 60° restent dans l'anneau d'origine.
    expect(ringOf(70, split)).toBe('north');
    expect(ringOf(45, split)).toBe('ring-4');
  });

  it('refuse une latitude hors de l anneau ou collée à son bord', () => {
    expect(splitRing(cfg, 0, 10)).toBeUndefined();
    expect(splitRing(cfg, 0, 30.5)).toBeUndefined();
  });

  it('s arrête au plafond d anneaux', () => {
    let current: RingConfig = cfg;
    while (current.rings.length < MAX_RINGS) {
      const { north, south } = ringBounds(current, 0);
      current = splitRing(current, 0, (north + south) / 2)!;
    }
    expect(splitRing(current, 0, 89)).toBeUndefined();
    expect(new Set(current.rings.map((r) => r.id)).size).toBe(MAX_RINGS);
  });
});

describe('fusion et déplacement des coupures', () => {
  it('fusionne deux anneaux en gardant celui du nord', () => {
    const merged = removeCut(cfg, 0)!;
    expect(merged.rings.map((r) => r.id)).toEqual(['north', 'south']);
    expect(merged.cutsLat).toEqual([-30]);
  });

  it('borne une coupure entre ses voisines', () => {
    expect(moveCut(cfg, 0, -50).cutsLat).toEqual([-29, -30]);
    expect(moveCut(cfg, 0, 95).cutsLat).toEqual([89, -30]);
  });

  it('retrouve un anneau par son identifiant, ou par la latitude à défaut', () => {
    expect(ringById(cfg, 'south', 0).id).toBe('south');
    expect(ringById(cfg, 'disparu', 50).id).toBe('north');
  });
});

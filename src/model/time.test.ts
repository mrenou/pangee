import { describe, expect, it } from 'vitest';
import { DEFAULT_RING_CONFIG, type RingConfig } from '@/model/ring';
import {
  kmPerDay,
  localToWorldLon,
  midLat,
  omegaFromKmPerDay,
  ringOffsetDeg,
  ringOffsetsDeg,
  worldToLocalLon,
} from '@/model/time';

const cfg: RingConfig = {
  ...DEFAULT_RING_CONFIG,
  rings: {
    north: { id: 'north', omegaDegPerDay: 1 },
    equator: { id: 'equator', omegaDegPerDay: 0 },
    south: { id: 'south', omegaDegPerDay: -0.5 },
  },
};

describe('rotation des anneaux', () => {
  it('aligne tous les anneaux à t0 : la carte est le monde d avant', () => {
    const offsets = ringOffsetsDeg(cfg, cfg.t0);
    expect(offsets.north).toBe(0);
    expect(offsets.equator).toBe(0);
    expect(offsets.south).toBe(0);
  });

  it('laisse un anneau de vitesse nulle immobile quelle que soit la date', () => {
    expect(ringOffsetDeg(cfg.rings.equator, 10_000, cfg.t0)).toBe(0);
  });

  it('tourne dans le sens du signe de omega', () => {
    expect(ringOffsetDeg(cfg.rings.north, 10, cfg.t0)).toBeCloseTo(10);
    expect(ringOffsetDeg(cfg.rings.south, 10, cfg.t0)).toBeCloseTo(-5);
  });

  it('boucle après un tour complet', () => {
    expect(ringOffsetDeg(cfg.rings.north, 360, cfg.t0)).toBeCloseTo(0);
    expect(ringOffsetDeg(cfg.rings.north, 365, cfg.t0)).toBeCloseTo(5);
  });

  it('respecte un t0 décalé', () => {
    const shifted: RingConfig = { ...cfg, t0: 100 };
    expect(ringOffsetDeg(shifted.rings.north, 100, shifted.t0)).toBe(0);
    expect(ringOffsetDeg(shifted.rings.north, 110, shifted.t0)).toBeCloseTo(10);
  });
});

describe('conversion entre référentiels', () => {
  it('ne change rien à t0', () => {
    expect(localToWorldLon(42, 60, cfg, cfg.t0)).toBeCloseTo(42);
  });

  it('fait l aller-retour local → monde → local à toute date', () => {
    for (const lat of [80, 45, 0, -45, -80]) {
      for (const tDays of [0, 7, 123.5, 10_000, -50]) {
        const lonLocal = 137.25;
        const lonWorld = localToWorldLon(lonLocal, lat, cfg, tDays);
        expect(worldToLocalLon(lonWorld, lat, cfg, tDays)).toBeCloseTo(lonLocal);
      }
    }
  });

  it('est déterministe : revenir à une date redonne exactement la même position', () => {
    const direct = localToWorldLon(10, 60, cfg, 4000);
    const detour = localToWorldLon(10, 60, cfg, 4000);
    expect(localToWorldLon(10, 60, cfg, 12)).not.toBeCloseTo(direct);
    expect(detour).toBe(direct);
  });

  it('fait passer une longitude par le méridien ±180 sans discontinuité', () => {
    // 170° local sur l'anneau nord, qui a tourné de 20° : on ressort à -170.
    expect(localToWorldLon(170, 60, cfg, 20)).toBeCloseTo(-170);
  });

  it('décale chaque anneau indépendamment', () => {
    const tDays = 30;
    expect(localToWorldLon(0, 60, cfg, tDays)).toBeCloseTo(30);
    expect(localToWorldLon(0, 0, cfg, tDays)).toBeCloseTo(0);
    expect(localToWorldLon(0, -60, cfg, tDays)).toBeCloseTo(-15);
  });
});

describe('vitesses affichées', () => {
  it('place la latitude médiane au milieu de chaque anneau', () => {
    expect(midLat('north', cfg)).toBeCloseTo(60);
    expect(midLat('equator', cfg)).toBeCloseTo(0);
    expect(midLat('south', cfg)).toBeCloseTo(-60);
  });

  it('convertit degrés par jour en kilomètres par jour à l équateur', () => {
    // Un tour de planète en un an : 2πR / 360 ≈ 111 km par degré.
    expect(kmPerDay(1, 0, 6371)).toBeCloseTo(111.19, 1);
  });

  it('rétrécit vers les pôles', () => {
    expect(Math.abs(kmPerDay(1, 60, 6371))).toBeLessThan(Math.abs(kmPerDay(1, 0, 6371)));
    expect(kmPerDay(1, 90, 6371)).toBeCloseTo(0);
  });

  it('conserve le signe, qui porte le sens de rotation', () => {
    expect(kmPerDay(-1, 0, 6371)).toBeLessThan(0);
  });

  it('fait l aller-retour avec la conversion inverse', () => {
    const omega = 0.37;
    const lat = 42;
    expect(omegaFromKmPerDay(kmPerDay(omega, lat, 6371), lat, 6371)).toBeCloseTo(omega);
  });
});

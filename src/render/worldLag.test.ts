import { describe, expect, it } from 'vitest';
import { DEFAULT_RING_CONFIG, type RingConfig, threeRings } from '@/model/ring';
import { ringOffsetDeg } from '@/model/time';
import { worldLagDeg } from '@/render/worldLag';

const cfg: RingConfig = {
  ...DEFAULT_RING_CONFIG,
  rings: threeRings({ north: 0.05, equator: 0, south: -0.03 }),
};

describe('retard des couches dérivées', () => {
  it('est nul quand la couche est à jour', () => {
    expect(worldLagDeg(cfg, 50, 1000, 1000)).toBe(0);
  });

  it('est nul sur un anneau immobile, quelle que soit la date', () => {
    expect(worldLagDeg(cfg, 0, 9000, 0)).toBe(0);
  });

  it('vaut ce que l anneau a parcouru depuis le calcul', () => {
    const lag = worldLagDeg(cfg, 50, 1000, 200);
    expect(lag).toBeCloseTo(0.05 * 800, 6);
  });

  it('suit le sens de rotation de chaque anneau', () => {
    expect(worldLagDeg(cfg, 50, 1000, 0)).toBeGreaterThan(0);
    expect(worldLagDeg(cfg, -50, 1000, 0)).toBeLessThan(0);
  });

  it("s'annule quand on revient à la date du calcul", () => {
    expect(worldLagDeg(cfg, 50, 200, 200)).toBe(0);
  });

  it('remet une couche exactement en place', () => {
    // Une cellule assemblée à la date du calcul occupait la longitude
    // lonLocal + Δ(calcul). En lui ajoutant le retard, on retombe sur la
    // longitude qu'elle doit occuper aujourd'hui : lonLocal + Δ(maintenant).
    const lonLocal = 42;
    const atCalc = lonLocal + ringOffsetDeg(cfg.rings[0]!, 300, cfg.t0);
    const shown = atCalc + worldLagDeg(cfg, 50, 1700, 300);
    expect(shown).toBeCloseTo(lonLocal + ringOffsetDeg(cfg.rings[0]!, 1700, cfg.t0), 6);
  });

  it('change de valeur de part et d autre d une coupure', () => {
    const north = worldLagDeg(cfg, cfg.cutsLat[0]! + 1, 1000, 0);
    const equator = worldLagDeg(cfg, cfg.cutsLat[0]! - 1, 1000, 0);
    expect(north).not.toBe(equator);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_RING_CONFIG, ringOf, validateRingConfig, type RingConfig } from '@/model/ring';

const cfg: RingConfig = DEFAULT_RING_CONFIG;

describe('ringOf', () => {
  it('découpe la planète en trois bandes', () => {
    expect(ringOf(60, cfg)).toBe('north');
    expect(ringOf(0, cfg)).toBe('equator');
    expect(ringOf(-60, cfg)).toBe('south');
  });

  it('range la latitude de coupure elle-même du côté équatorial', () => {
    // La frontière est nette : cutNorthLat appartient à l'équateur, et le
    // premier point strictement au-dessus bascule au nord.
    expect(ringOf(cfg.cutNorthLat, cfg)).toBe('equator');
    expect(ringOf(cfg.cutNorthLat + 1e-9, cfg)).toBe('north');
    expect(ringOf(cfg.cutSouthLat, cfg)).toBe('equator');
    expect(ringOf(cfg.cutSouthLat - 1e-9, cfg)).toBe('south');
  });

  it('couvre les pôles', () => {
    expect(ringOf(90, cfg)).toBe('north');
    expect(ringOf(-90, cfg)).toBe('south');
  });
});

describe('validateRingConfig', () => {
  it('accepte la configuration par défaut', () => {
    expect(validateRingConfig(cfg)).toEqual([]);
  });

  it('refuse des coupures inversées ou confondues', () => {
    expect(validateRingConfig({ ...cfg, cutNorthLat: -40 })).toContain('cuts-out-of-order');
    expect(validateRingConfig({ ...cfg, cutNorthLat: cfg.cutSouthLat })).toContain(
      'cuts-out-of-order',
    );
  });

  it('refuse une coupure au pôle, qui viderait un anneau', () => {
    expect(validateRingConfig({ ...cfg, cutNorthLat: 90 })).toContain('cut-out-of-range');
  });

  it('refuse une vitesse non finie', () => {
    const broken: RingConfig = {
      ...cfg,
      rings: { ...cfg.rings, north: { id: 'north', omegaDegPerDay: Number.NaN } },
    };
    expect(validateRingConfig(broken)).toContain('omega-not-finite');
  });
});

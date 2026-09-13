import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, rngFor } from '@/gen/rng';

describe('hashSeed', () => {
  it('donne le même hash pour la même seed et le même domaine', () => {
    expect(hashSeed('pangee', 'relief')).toBe(hashSeed('pangee', 'relief'));
  });

  it('sépare les domaines : changer les villes ne rejoue pas le relief', () => {
    expect(hashSeed('pangee', 'relief')).not.toBe(hashSeed('pangee', 'places'));
  });

  it('sépare les seeds', () => {
    expect(hashSeed('pangee', 'relief')).not.toBe(hashSeed('pangée', 'relief'));
    expect(hashSeed(1, 'relief')).not.toBe(hashSeed(2, 'relief'));
  });

  it('reste un entier non signé sur 32 bits', () => {
    for (const seed of ['', 'a', 'monde très très long avec des accents', 42, -7]) {
      const h = hashSeed(seed, 'names');
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe('mulberry32', () => {
  it('est reproductible à état égal', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('reste dans [0, 1[', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('a une moyenne proche de 0,5 sur un grand échantillon', () => {
    const rng = rngFor('pangee', 'relief');
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i += 1) sum += rng();
    expect(sum / n).toBeCloseTo(0.5, 2);
  });
});

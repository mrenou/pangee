import { describe, expect, it } from 'vitest';
import { cultureOfLat, generateName, nameForPlace, type NameCulture } from '@/gen/names';
import { hashSeed, mulberry32, rngFor } from '@/gen/rng';

const CULTURES: readonly NameCulture[] = ['north', 'equator', 'south'];

describe('toponymes', () => {
  it('produit des noms de longueur plausible', () => {
    for (const ring of CULTURES) {
      const rng = rngFor('pangee', 'names');
      for (let i = 0; i < 200; i += 1) {
        const name = generateName(ring, rng);
        expect(name.length).toBeGreaterThanOrEqual(4);
        expect(name.length).toBeLessThanOrEqual(13);
        expect(name).toMatch(/^[A-Z][a-z]+$/);
      }
    }
  });

  it('est déterministe à graine égale', () => {
    expect(generateName('north', mulberry32(4242))).toBe(generateName('north', mulberry32(4242)));
  });

  it('donne à chaque lieu un nom stable, lié à son identifiant', () => {
    const first = nameForPlace('equator', hashSeed('place-17', 'names'));
    expect(nameForPlace('equator', hashSeed('place-17', 'names'))).toBe(first);
    expect(nameForPlace('equator', hashSeed('place-18', 'names'))).not.toBe(first);
  });

  it('varie : deux cents tirages ne donnent pas dix noms', () => {
    const rng = rngFor('pangee', 'names');
    const names = new Set<string>();
    for (let i = 0; i < 200; i += 1) names.add(generateName('equator', rng));
    expect(names.size).toBeGreaterThan(120);
  });

  it('donne des sonorités distinctes selon l anneau', () => {
    // Les corpus n'ont pas les mêmes lettres : le sud est riche en voyelles,
    // le nord en groupes consonantiques. On compare les distributions.
    const sample = (ring: 'north' | 'south'): string => {
      const rng = rngFor('pangee', 'names');
      let all = '';
      for (let i = 0; i < 150; i += 1) all += generateName(ring, rng);
      return all;
    };
    const vowelRatio = (text: string): number =>
      (text.match(/[aeiouy]/gi) ?? []).length / text.length;

    expect(vowelRatio(sample('south'))).toBeGreaterThan(vowelRatio(sample('north')));
  });
});

describe('cultures toponymiques', () => {
  it('suivent la latitude, et non le découpage en anneaux', () => {
    expect(cultureOfLat(45)).toBe('north');
    expect(cultureOfLat(30)).toBe('equator');
    expect(cultureOfLat(-30)).toBe('equator');
    expect(cultureOfLat(-31)).toBe('south');
  });
});

import { describe, expect, it } from 'vitest';
import { Biome } from '@/climate';
import { DRY } from '@/hydro/types';
import {
  distanceKm,
  kindFor,
  minDistanceKm,
  placePlaces,
  sizeFor,
  targetPlaceCount,
} from '@/gen/places';
import { DEFAULT_RING_CONFIG, ringOf } from '@/model/ring';
import type { RasterSize } from '@/model/world';

const RADIUS_KM = 6371;

describe('cible de peuplement', () => {
  it('va d une cinquantaine de lieux à cent cinquante', () => {
    expect(targetPlaceCount(0)).toBe(50);
    expect(targetPlaceCount(1)).toBe(150);
    expect(targetPlaceCount(0.5)).toBe(100);
  });

  it('resserre la distance minimale quand on demande plus de lieux', () => {
    expect(minDistanceKm(0)).toBeGreaterThan(minDistanceKm(1));
    expect(minDistanceKm(1)).toBeGreaterThan(0);
  });
});

describe('distance sur le cylindre', () => {
  it('mesure un degré de latitude à une centaine de kilomètres', () => {
    expect(distanceKm(0, 0, 0, 1, RADIUS_KM)).toBeCloseTo(111.2, 0);
  });

  it('passe par le méridien ±180 plutôt que de faire le tour', () => {
    // De 179°E à 179°O : deux degrés, pas trois cent cinquante-huit.
    expect(distanceKm(179, 0, -179, 0, RADIUS_KM)).toBeCloseTo(222.4, 0);
  });

  it('rétrécit vers les pôles', () => {
    expect(distanceKm(0, 60, 1, 60, RADIUS_KM)).toBeLessThan(distanceKm(0, 0, 1, 0, RADIUS_KM));
  });
});

describe('type et taille', () => {
  it('donne les plus grandes tailles aux mieux placés', () => {
    expect(sizeFor(0)).toBe(4);
    expect(sizeFor(0.99)).toBe(1);
    expect(sizeFor(0.5)).toBeLessThan(sizeFor(0.1));
  });

  it('fait des villes en tête de classement et des villages en queue', () => {
    expect(kindFor(0, 0.5, 100)).toBe('city');
    expect(kindFor(0.9, 0.5, 100)).toBe('village');
  });

  it('ne fait de volcan qu en altitude', () => {
    expect(kindFor(0.5, 0.8, 2000)).toBe('volcano');
    expect(kindFor(0.5, 0.8, 200)).not.toBe('volcano');
  });

  it('réserve une part du monde aux ruines et aux forteresses', () => {
    expect(kindFor(0, 0.95, 100)).toBe('ruin');
    expect(kindFor(0, 0.9, 100)).toBe('fortress');
  });
});

describe('placement', () => {
  /**
   * Un monde jouet : une mer à l'ouest, un continent tempéré à l'est, plat et
   * juste au-dessus du niveau de la mer.
   */
  function world(size: RasterSize): {
    heightWorld: Float32Array;
    waterLevel: Float32Array;
    flowAcc: Float32Array;
    biome: Uint8Array;
  } {
    const cells = size.width * size.height;
    const heightWorld = new Float32Array(cells);
    const waterLevel = new Float32Array(cells).fill(DRY);
    const flowAcc = new Float32Array(cells).fill(1);
    const biome = new Uint8Array(cells).fill(Biome.TemperateForest);

    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const i = y * size.width + x;
        if (x < size.width / 3) {
          heightWorld[i] = -400;
          waterLevel[i] = 0;
          biome[i] = Biome.Ocean;
        } else {
          heightWorld[i] = 120;
        }
      }
    }
    return { heightWorld, waterLevel, flowAcc, biome };
  }

  const size: RasterSize = { width: 256, height: 128 };

  function run(placeDensity = 0.5, seed = 'pangee') {
    const { heightWorld, waterLevel, flowAcc, biome } = world(size);
    return placePlaces({
      size,
      heightWorld,
      waterLevel,
      flowAcc,
      biome,
      seaLevelM: 0,
      riverThreshold: 1e9,
      radiusKm: RADIUS_KM,
      ringConfig: DEFAULT_RING_CONFIG,
      seed,
      placeDensity,
    });
  }

  it('place des lieux et leur donne un nom', () => {
    const places = run();
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      expect(place.name.length).toBeGreaterThan(2);
      expect(place.id).toMatch(/^place-\d+$/);
    }
  });

  it('ne fonde rien sous l eau', () => {
    const { heightWorld, waterLevel } = world(size);
    for (const place of run()) {
      const x = Math.floor(((place.lon + 180) / 360) * size.width);
      const y = Math.floor(((90 - place.lat) / 180) * size.height);
      const i = y * size.width + x;
      expect(waterLevel[i]).not.toBeGreaterThan(heightWorld[i]!);
    }
  });

  it('respecte la distance minimale entre deux lieux', () => {
    const places = run(0.5);
    const minimum = minDistanceKm(0.5);
    for (let a = 0; a < places.length; a += 1) {
      for (let b = a + 1; b < places.length; b += 1) {
        const d = distanceKm(
          places[a]!.lon,
          places[a]!.lat,
          places[b]!.lon,
          places[b]!.lat,
          RADIUS_KM,
        );
        expect(d).toBeGreaterThanOrEqual(minimum - 1e-6);
      }
    }
  });

  it('attribue à chaque lieu l anneau de sa latitude', () => {
    for (const place of run()) {
      expect(place.ringId).toBe(ringOf(place.lat, DEFAULT_RING_CONFIG));
    }
  });

  it('est déterministe : même graine, mêmes lieux', () => {
    expect(run(0.5, 'alpha')).toEqual(run(0.5, 'alpha'));
  });

  it('change de peuplement quand la graine change', () => {
    expect(run(0.5, 'alpha')).not.toEqual(run(0.5, 'beta'));
  });

  it('fonde davantage de lieux quand la densité augmente', () => {
    expect(run(1).length).toBeGreaterThan(run(0).length);
  });
});

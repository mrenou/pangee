import { describe, expect, it } from 'vitest';
import { idx } from '@/model/coords';
import type { RasterSize } from '@/model/world';
import {
  Biome,
  baseTemperatureC,
  classify,
  computeBiomes,
  createClimateBuffers,
  distanceToWater,
  latitudeHumidity,
  temperatureC,
} from '@/climate';
import { DRY } from '@/hydro/types';

describe('température', () => {
  it('est chaude à l équateur et glaciale aux pôles', () => {
    expect(baseTemperatureC(0)).toBeCloseTo(30, 0);
    expect(baseTemperatureC(90)).toBeLessThan(-20);
  });

  it('est symétrique entre les hémisphères', () => {
    expect(baseTemperatureC(42)).toBeCloseTo(baseTemperatureC(-42), 6);
  });

  it('décroît avec l altitude au taux atmosphérique', () => {
    // 6,5 °C pour mille mètres.
    expect(temperatureC(0, 0) - temperatureC(0, 1000)).toBeCloseTo(6.5, 3);
  });

  it('ignore la profondeur sous le niveau de la mer', () => {
    expect(temperatureC(0, -500)).toBeCloseTo(temperatureC(0, 0), 6);
  });
});

describe('ceintures de pluie', () => {
  it('arrose l équateur', () => {
    expect(latitudeHumidity(0)).toBeGreaterThan(0.9);
  });

  it('assèche les latitudes des déserts', () => {
    expect(latitudeHumidity(25)).toBeLessThan(0.3);
    expect(latitudeHumidity(25)).toBeLessThan(latitudeHumidity(0));
    expect(latitudeHumidity(25)).toBeLessThan(latitudeHumidity(55));
  });

  it('reste dans [0, 1]', () => {
    for (let lat = -90; lat <= 90; lat += 1) {
      expect(latitudeHumidity(lat)).toBeGreaterThanOrEqual(0);
      expect(latitudeHumidity(lat)).toBeLessThanOrEqual(1);
    }
  });
});

describe('classification', () => {
  it('place la glace au grand froid', () => {
    expect(classify(-30, 0.5, 0, false)).toBe(Biome.Ice);
  });

  it('place le désert au chaud et au sec', () => {
    expect(classify(28, 0.05, 200, false)).toBe(Biome.Desert);
  });

  it('place la forêt tropicale au chaud et à l humide', () => {
    expect(classify(28, 0.9, 100, false)).toBe(Biome.TropicalRainforest);
  });

  it('place la steppe au tempéré sec et la forêt au tempéré humide', () => {
    expect(classify(14, 0.1, 200, false)).toBe(Biome.Steppe);
    expect(classify(14, 0.5, 200, false)).toBe(Biome.TemperateForest);
  });

  it('dénude les hautes altitudes froides', () => {
    expect(classify(0, 0.6, 3200, false)).toBe(Biome.Alpine);
  });

  it('fait primer le marais sur tout le reste', () => {
    expect(classify(28, 0.05, 5, true)).toBe(Biome.Marsh);
  });
});

describe('distance à l eau', () => {
  const size: RasterSize = { width: 8, height: 4 };

  it('met l eau à zéro et s éloigne régulièrement', () => {
    const isWater = new Uint8Array(size.width * size.height);
    isWater[idx(0, 0, size.width)] = 1;
    const d = distanceToWater(size, isWater, new Float32Array(isWater.length));
    expect(d[idx(0, 0, size.width)]).toBe(0);
    expect(d[idx(1, 0, size.width)]).toBeCloseTo(1, 5);
    expect(d[idx(2, 0, size.width)]).toBeCloseTo(2, 5);
  });

  it('passe par le méridien ±180 quand c est le chemin le plus court', () => {
    // De l'eau en colonne 0 : la dernière colonne est sa voisine, pas la plus
    // lointaine du monde.
    const isWater = new Uint8Array(size.width * size.height);
    isWater[idx(0, 0, size.width)] = 1;
    const d = distanceToWater(size, isWater, new Float32Array(isWater.length));
    expect(d[idx(size.width - 1, 0, size.width)]).toBeCloseTo(1, 5);
  });

  it('approche la distance euclidienne en diagonale', () => {
    const isWater = new Uint8Array(size.width * size.height);
    isWater[idx(0, 0, size.width)] = 1;
    const d = distanceToWater(size, isWater, new Float32Array(isWater.length));
    // Le chanfrein 3-4 sous-estime la diagonale d'environ 5 %.
    const exact = Math.SQRT2 * 2;
    const measured = d[idx(2, 2, size.width)]!;
    expect(measured).toBeLessThan(exact);
    expect(measured).toBeGreaterThan(exact * 0.9);
  });
});

describe('carte des biomes', () => {
  const size: RasterSize = { width: 16, height: 8 };

  function inputs(): {
    heightWorld: Float32Array;
    waterLevel: Float32Array;
    flowAcc: Float32Array;
  } {
    const cells = size.width * size.height;
    const heightWorld = new Float32Array(cells);
    const waterLevel = new Float32Array(cells).fill(DRY);
    const flowAcc = new Float32Array(cells).fill(1);
    // Moitié ouest en mer, moitié est en terre à 200 m.
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const i = idx(x, y, size.width);
        if (x < size.width / 2) {
          heightWorld[i] = -500;
          waterLevel[i] = 0;
        } else {
          heightWorld[i] = 200;
        }
      }
    }
    return { heightWorld, waterLevel, flowAcc };
  }

  it('marque la mer comme océan', () => {
    const { heightWorld, waterLevel, flowAcc } = inputs();
    const biome = computeBiomes(
      { size, heightWorld, waterLevel, flowAcc, seaLevelM: 0, riverThreshold: 1e9 },
      createClimateBuffers(size),
    );
    expect(biome[idx(1, 4, size.width)]).toBe(Biome.Ocean);
    expect(biome[idx(12, 4, size.width)]).not.toBe(Biome.Ocean);
  });

  it('glace les pôles et épargne l équateur', () => {
    const { heightWorld, waterLevel, flowAcc } = inputs();
    const biome = computeBiomes(
      { size, heightWorld, waterLevel, flowAcc, seaLevelM: 0, riverThreshold: 1e9 },
      createClimateBuffers(size),
    );
    expect(biome[idx(12, 0, size.width)]).toBe(Biome.Ice);
    expect(biome[idx(12, 4, size.width)]).not.toBe(Biome.Ice);
  });

  it('laisse le dernier mot à l override du MJ', () => {
    const { heightWorld, waterLevel, flowAcc } = inputs();
    const override = new Uint8Array(size.width * size.height);
    override[idx(12, 4, size.width)] = Biome.Desert;
    const biome = computeBiomes(
      {
        size,
        heightWorld,
        waterLevel,
        flowAcc,
        seaLevelM: 0,
        riverThreshold: 1e9,
        biomeOverride: override,
      },
      createClimateBuffers(size),
    );
    expect(biome[idx(12, 4, size.width)]).toBe(Biome.Desert);
  });

  it('assèche l intérieur des terres', () => {
    // Un continent assez large pour que la continentalité joue : la portée du
    // climat océanique vaut 6 % de la largeur du monde. Le climat porte aussi
    // un bruit, donc on compare des populations et non deux cellules.
    const wide: RasterSize = { width: 128, height: 16 };
    const cells = wide.width * wide.height;
    const heightWorld = new Float32Array(cells).fill(200);
    const waterLevel = new Float32Array(cells).fill(DRY);
    const flowAcc = new Float32Array(cells).fill(1);
    for (let y = 0; y < wide.height; y += 1) {
      const i = idx(0, y, wide.width);
      heightWorld[i] = -500;
      waterLevel[i] = 0;
    }

    const biome = computeBiomes(
      { size: wide, heightWorld, waterLevel, flowAcc, seaLevelM: 0, riverThreshold: 1e9 },
      createClimateBuffers(wide),
    );

    const DRY_BIOMES = new Set<number>([Biome.Desert, Biome.Steppe, Biome.Savanna]);
    const dryRatio = (fromX: number, toX: number): number => {
      let dry = 0;
      let total = 0;
      for (let y = 0; y < wide.height; y += 1) {
        for (let x = fromX; x < toX; x += 1) {
          const b = biome[idx(x, y, wide.width)]!;
          if (b === Biome.Ocean) continue;
          total += 1;
          if (DRY_BIOMES.has(b)) dry += 1;
        }
      }
      return total === 0 ? 0 : dry / total;
    };

    // La bande côtière est plus arrosée que le cœur du continent.
    expect(dryRatio(1, 5)).toBeLessThan(dryRatio(40, 80));
  });
});

import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  FORMAT_VERSION,
  HEIGHT_MAX_M,
  HEIGHT_MIN_M,
  dequantizeHeight,
  parseWorld,
  quantizeHeight,
  serializeWorld,
  type WorldDocument,
} from '@/model/file';
import { DEFAULT_RING_CONFIG } from '@/model/ring';
import type { Place, RasterSize, Road } from '@/model/world';

const size: RasterSize = { width: 32, height: 16 };
const fogSize: RasterSize = { width: 8, height: 4 };

function document(): WorldDocument {
  const cells = size.width * size.height;
  const height = new Float32Array(cells);
  for (let i = 0; i < cells; i += 1) height[i] = -2000 + (i % 400) * 15;

  const biomeOverride = new Uint8Array(cells);
  biomeOverride[5] = 8;
  biomeOverride[6] = 8;

  const fog = new Uint8Array(fogSize.width * fogSize.height);
  fog[3] = 255;

  const places: readonly Place[] = [
    { id: 'p1', ringId: 'equator', lon: 12.5, lat: -3.25, name: 'Aventhis', kind: 'city', size: 4 },
    {
      id: 'p2',
      ringId: 'north',
      lon: -40,
      lat: 55,
      name: 'Vorngard',
      kind: 'town',
      size: 2,
      notes: 'port',
    },
  ];
  const roads: readonly Road[] = [
    {
      id: 'r1',
      ringId: 'equator',
      kind: 'road',
      points: [
        [0, 0],
        [5, 5],
      ],
    },
  ];

  return {
    id: 'w1',
    name: 'Pangée',
    seed: 'graine-test',
    ringConfig: DEFAULT_RING_CONFIG,
    radiusKm: 6371,
    seaLevelM: 0,
    campaignDate: 1234,
    size,
    height,
    biomeOverride,
    fogSize,
    fog,
    places,
    roads,
  };
}

describe('quantification du relief', () => {
  it('fait l aller-retour à mieux qu un mètre près', () => {
    const height = new Float32Array([-12000, -500, 0, 1234.5, 6000, 9000]);
    const back = dequantizeHeight(
      quantizeHeight(height),
      (HEIGHT_MAX_M - HEIGHT_MIN_M) / 65535,
      HEIGHT_MIN_M,
    );
    for (let i = 0; i < height.length; i += 1) {
      expect(Math.abs(back[i]! - height[i]!)).toBeLessThan(1);
    }
  });

  it('borne les valeurs hors plage au lieu de les replier', () => {
    const raw = quantizeHeight(new Float32Array([-99999, 99999]));
    expect(raw[0]).toBe(0);
    expect(raw[1]).toBe(65535);
  });
});

describe('aller-retour complet', () => {
  it('retrouve un monde identique', () => {
    const original = document();
    const parsed = parseWorld(serializeWorld(original));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const back = parsed.value;
    expect(back.id).toBe(original.id);
    expect(back.name).toBe(original.name);
    expect(back.seed).toBe(original.seed);
    expect(back.campaignDate).toBe(original.campaignDate);
    expect(back.radiusKm).toBe(original.radiusKm);
    expect(back.size).toEqual(original.size);
    expect(back.ringConfig).toEqual(original.ringConfig);
    expect(back.places).toEqual(original.places);
    expect(back.roads).toEqual(original.roads);
    expect(Array.from(back.biomeOverride)).toEqual(Array.from(original.biomeOverride));
    expect(Array.from(back.fog)).toEqual(Array.from(original.fog));
  });

  it('conserve le relief au mètre près en quantifié', () => {
    const original = document();
    const parsed = parseWorld(serializeWorld(original));
    if (!parsed.ok) throw new Error(parsed.error);
    for (let i = 0; i < original.height.length; i += 1) {
      expect(Math.abs(parsed.value.height[i]! - original.height[i]!)).toBeLessThan(1);
    }
  });

  it('conserve le relief bit à bit en float32', () => {
    const original = document();
    const parsed = parseWorld(serializeWorld(original, { heightEncoding: 'float32' }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(Array.from(parsed.value.height)).toEqual(Array.from(original.height));
  });

  it('pèse moins en quantifié qu en float32', () => {
    const original = document();
    expect(serializeWorld(original).byteLength).toBeLessThan(
      serializeWorld(original, { heightEncoding: 'float32' }).byteLength,
    );
  });

  it('ne partage pas la mémoire des tampons d origine', () => {
    const original = document();
    const bytes = serializeWorld(original, { heightEncoding: 'float32' });
    const parsed = parseWorld(bytes);
    if (!parsed.ok) throw new Error(parsed.error);

    parsed.value.height[0] = 12345;
    expect(original.height[0]).not.toBe(12345);
  });
});

describe('robustesse à l import', () => {
  it('refuse ce qui n est pas une archive', () => {
    const parsed = parseWorld(new Uint8Array([1, 2, 3, 4]));
    expect(parsed.ok).toBe(false);
  });

  it('refuse un format plus récent, avec un message clair', () => {
    const future = parseWorld(serializeWorldWithVersion(document(), FORMAT_VERSION + 1));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toContain('plus récente');
  });

  it('refuse une archive dont une couche ne fait pas la taille annoncée', () => {
    const original = document();
    const parsed = parseWorld(truncateEntry(serializeWorld(original)));
    expect(parsed.ok).toBe(false);
  });
});

/** Réécrit l'archive en changeant la version déclarée, pour les tests. */
function serializeWorldWithVersion(doc: WorldDocument, version: number): Uint8Array {
  const entries = unzipSync(serializeWorld(doc));
  const manifest = JSON.parse(new TextDecoder().decode(entries['world.json'])) as {
    formatVersion: number;
  };
  manifest.formatVersion = version;
  entries['world.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  return zipSync(entries);
}

/** Tronque biome.bin pour simuler une archive abîmée. */
function truncateEntry(bytes: Uint8Array): Uint8Array {
  const entries = unzipSync(bytes);
  entries['biome.bin'] = entries['biome.bin']!.slice(0, 4);
  return zipSync(entries);
}

/**
 * Format de fichier `.pangee` : une archive zip contenant les métadonnées en
 * JSON et les rasters en binaire.
 *
 * Tout y est en référentiel local. Rien n'est stocké en référentiel monde,
 * puisque celui-ci se recalcule à partir de la date.
 * Voir docs/fichier-pangee.md.
 */

import { unzipSync, zipSync } from 'fflate';
import { validateRingConfig, type RingConfig } from '@/model/ring';
import {
  CREATURE_KINDS,
  type Creature,
  type Place,
  type RasterSize,
  type Road,
} from '@/model/world';

/** Version 2 : ajout des créatures. Version 3 : anneaux en nombre variable. */
export const FORMAT_VERSION = 3;
export const APP_NAME = 'pangee';

/** Plage couverte par la quantification du relief, en mètres. */
export const HEIGHT_MIN_M = -12000;
export const HEIGHT_MAX_M = 9000;
const HEIGHT_SCALE_M = (HEIGHT_MAX_M - HEIGHT_MIN_M) / 65535;

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export interface WorldDocument {
  readonly id: string;
  readonly name: string;
  readonly seed: string;
  readonly ringConfig: RingConfig;
  readonly radiusKm: number;
  readonly seaLevelM: number;
  readonly campaignDate: number;
  readonly size: RasterSize;
  readonly height: Float32Array;
  readonly biomeOverride: Uint8Array;
  readonly fogSize: RasterSize;
  readonly fog: Uint8Array;
  readonly places: readonly Place[];
  readonly roads: readonly Road[];
  readonly creatures: readonly Creature[];
  readonly createdAt?: string;
}

type HeightEncoding = 'float32' | 'uint16';

interface HeightLayerIndex {
  readonly file: 'height.bin';
  readonly type: HeightEncoding;
  readonly scaleM?: number;
  readonly offsetM?: number;
}

interface WorldFile {
  readonly formatVersion: number;
  readonly app: { readonly name: string; readonly version: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly world: {
    readonly id: string;
    readonly name: string;
    readonly seed: string;
    readonly radiusKm: number;
    readonly seaLevelM: number;
    readonly campaignDate: number;
  };
  readonly rings: RingConfig;
  readonly rasters: {
    readonly width: number;
    readonly height: number;
    readonly endianness: 'little';
    readonly layers: {
      readonly height: HeightLayerIndex;
      readonly biome: { readonly file: 'biome.bin'; readonly type: 'uint8' };
      readonly fog: {
        readonly file: 'fog.bin';
        readonly type: 'uint8';
        readonly width: number;
        readonly height: number;
      };
    };
  };
  readonly places: readonly Place[];
  readonly roads: readonly Road[];
  /** Absent avant la version 2. */
  readonly creatures?: readonly Creature[];
}

export interface SerializeOptions {
  /** `uint16` divise par deux la taille du relief, pour une précision de 32 cm. */
  readonly heightEncoding?: HeightEncoding;
  readonly appVersion?: string;
}

export function quantizeHeight(height: Float32Array): Uint16Array {
  const out = new Uint16Array(height.length);
  for (let i = 0; i < height.length; i += 1) {
    const raw = Math.round((height[i]! - HEIGHT_MIN_M) / HEIGHT_SCALE_M);
    out[i] = raw < 0 ? 0 : raw > 65535 ? 65535 : raw;
  }
  return out;
}

export function dequantizeHeight(raw: Uint16Array, scaleM: number, offsetM: number): Float32Array {
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw[i]! * scaleM + offsetM;
  return out;
}

/** Copie un tampon typé en octets, sans partager sa mémoire sous-jacente. */
function toBytes(view: Float32Array | Uint16Array | Uint8Array): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

export function serializeWorld(doc: WorldDocument, options: SerializeOptions = {}): Uint8Array {
  const encoding: HeightEncoding = options.heightEncoding ?? 'uint16';
  const now = new Date().toISOString();

  const heightLayer: HeightLayerIndex =
    encoding === 'uint16'
      ? { file: 'height.bin', type: 'uint16', scaleM: HEIGHT_SCALE_M, offsetM: HEIGHT_MIN_M }
      : { file: 'height.bin', type: 'float32' };

  const file: WorldFile = {
    formatVersion: FORMAT_VERSION,
    app: { name: APP_NAME, version: options.appVersion ?? '0.1.0' },
    createdAt: doc.createdAt ?? now,
    updatedAt: now,
    world: {
      id: doc.id,
      name: doc.name,
      seed: doc.seed,
      radiusKm: doc.radiusKm,
      seaLevelM: doc.seaLevelM,
      campaignDate: doc.campaignDate,
    },
    rings: doc.ringConfig,
    rasters: {
      width: doc.size.width,
      height: doc.size.height,
      endianness: 'little',
      layers: {
        height: heightLayer,
        biome: { file: 'biome.bin', type: 'uint8' },
        fog: {
          file: 'fog.bin',
          type: 'uint8',
          width: doc.fogSize.width,
          height: doc.fogSize.height,
        },
      },
    },
    places: doc.places,
    roads: doc.roads,
    creatures: doc.creatures,
  };

  const heightBytes =
    encoding === 'uint16' ? toBytes(quantizeHeight(doc.height)) : toBytes(doc.height);

  return zipSync(
    {
      'world.json': new TextEncoder().encode(JSON.stringify(file, null, 2)),
      'height.bin': heightBytes,
      'biome.bin': toBytes(doc.biomeOverride),
      'fog.bin': toBytes(doc.fog),
    },
    // Le relief quantifié se comprime mal : insister coûterait du temps pour
    // rien. Les couches catégorielles, elles, sont pleines de plages
    // constantes et gagnent beaucoup.
    { level: 6 },
  );
}

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

/**
 * Relit une archive et valide sa structure avant de rendre quoi que ce soit :
 * l'appelant ne doit jamais se retrouver avec un monde à moitié chargé.
 */
export function parseWorld(bytes: Uint8Array): Result<WorldDocument> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return fail("Ce fichier n'est pas une archive .pangee lisible.");
  }

  const manifest = entries['world.json'];
  if (!manifest) return fail('Archive incomplète : world.json est absent.');

  let file: WorldFile;
  try {
    file = JSON.parse(new TextDecoder().decode(manifest)) as WorldFile;
  } catch {
    return fail('world.json est illisible.');
  }

  if (typeof file.formatVersion !== 'number') return fail('world.json ne déclare pas sa version.');
  if (file.formatVersion > FORMAT_VERSION) {
    return fail(
      `Ce monde vient d'une version plus récente de Pangée (format ${file.formatVersion}, ` +
        `cette application lit jusqu'à ${FORMAT_VERSION}).`,
    );
  }

  const migrated = migrate(file);
  if (!migrated.ok) return migrated;
  const current = migrated.value;

  const creatures = current.creatures ?? [];
  if (!Array.isArray(creatures) || !creatures.every(isCreature)) {
    return fail('world.json contient une créature mal formée.');
  }

  const ringErrors = validateRingConfig(current.rings);
  if (ringErrors.length > 0) {
    return fail(`Configuration d'anneaux invalide : ${ringErrors.join(', ')}.`);
  }

  const size: RasterSize = { width: current.rasters.width, height: current.rasters.height };
  const cells = size.width * size.height;
  if (!Number.isInteger(cells) || cells <= 0) return fail('Dimensions de raster invalides.');

  const heightBytes = entries['height.bin'];
  const biomeBytes = entries['biome.bin'];
  const fogBytes = entries['fog.bin'];
  if (!heightBytes || !biomeBytes || !fogBytes) {
    return fail('Archive incomplète : une couche raster est absente.');
  }

  const layer = current.rasters.layers.height;
  let height: Float32Array;

  if (layer.type === 'float32') {
    if (heightBytes.byteLength !== cells * 4)
      return fail('height.bin ne fait pas la taille annoncée.');
    height = new Float32Array(copyBuffer(heightBytes));
  } else {
    if (heightBytes.byteLength !== cells * 2)
      return fail('height.bin ne fait pas la taille annoncée.');
    const scaleM = layer.scaleM ?? HEIGHT_SCALE_M;
    const offsetM = layer.offsetM ?? HEIGHT_MIN_M;
    height = dequantizeHeight(new Uint16Array(copyBuffer(heightBytes)), scaleM, offsetM);
  }

  if (biomeBytes.byteLength !== cells) return fail('biome.bin ne fait pas la taille annoncée.');

  const fogSize: RasterSize = {
    width: current.rasters.layers.fog.width,
    height: current.rasters.layers.fog.height,
  };
  if (fogBytes.byteLength !== fogSize.width * fogSize.height) {
    return fail('fog.bin ne fait pas la taille annoncée.');
  }

  return {
    ok: true,
    value: {
      id: current.world.id,
      name: current.world.name,
      seed: String(current.world.seed),
      ringConfig: current.rings,
      radiusKm: current.world.radiusKm,
      seaLevelM: current.world.seaLevelM,
      campaignDate: current.world.campaignDate,
      size,
      height,
      biomeOverride: new Uint8Array(copyBuffer(biomeBytes)),
      fogSize,
      fog: new Uint8Array(copyBuffer(fogBytes)),
      places: current.places ?? [],
      roads: current.roads ?? [],
      creatures,
      createdAt: current.createdAt,
    },
  };
}

/** Une créature lue d'un fichier : on n'adopte que ce qui a la bonne forme. */
function isCreature(value: unknown): value is Creature {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    (CREATURE_KINDS as readonly unknown[]).includes(c.kind) &&
    typeof c.ringId === 'string' &&
    typeof c.speedDegPerS === 'number' &&
    Number.isFinite(c.speedDegPerS) &&
    typeof c.loop === 'boolean' &&
    Array.isArray(c.points) &&
    c.points.length >= 2 &&
    c.points.every(
      (p: unknown) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)),
    )
  );
}

/** Une vue typée doit posséder son tampon : celui du zip peut être une tranche. */
function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Migrations chaînées v(n) → v(n+1), chacune pure. Voir docs/fichier-pangee.md. */
function migrate(file: WorldFile): Result<WorldFile> {
  let current = file;
  while (current.formatVersion < FORMAT_VERSION) {
    const step = MIGRATIONS[current.formatVersion];
    if (!step) return fail(`Aucune migration depuis le format ${current.formatVersion}.`);
    current = step(current);
  }
  return { ok: true, value: current };
}

/** Les trois anneaux fixes des versions 1 et 2. */
interface LegacyRingConfig {
  readonly cutNorthLat: number;
  readonly cutSouthLat: number;
  readonly rings: Readonly<
    Record<'north' | 'equator' | 'south', { readonly omegaDegPerDay: number }>
  >;
  readonly t0: number;
}

const LEGACY_NAMES = {
  north: 'Anneau nord',
  equator: 'Anneau équatorial',
  south: 'Anneau sud',
} as const;

const MIGRATIONS: Readonly<Record<number, (file: WorldFile) => WorldFile>> = {
  // v1 → v2 : les créatures font leur entrée, aucune n'existait.
  1: (file) => ({ ...file, formatVersion: 2, creatures: [] }),
  // v2 → v3 : trois anneaux fixes deviennent une liste du nord au sud. Les
  // identifiants sont conservés, si bien que lieux, routes et créatures n'ont
  // rien à changer.
  2: (file) => {
    const legacy = file.rings as unknown as LegacyRingConfig;
    const ids = ['north', 'equator', 'south'] as const;
    return {
      ...file,
      formatVersion: 3,
      rings: {
        rings: ids.map((id) => ({
          id,
          name: LEGACY_NAMES[id],
          omegaDegPerDay: legacy.rings[id].omegaDegPerDay,
        })),
        cutsLat: [legacy.cutNorthLat, legacy.cutSouthLat],
        t0: legacy.t0,
      },
    };
  },
};

/**
 * Convertit une carte dessinée (PNG équirectangulaire, toute la planète) en monde `.pangee`.
 *
 * Chaque couleur de la légende devient une classe de terrain ; le relief en est déduit (distance
 * à la côte, profondeur dans un massif, bruit de détail), les biomes dessinés deviennent des
 * `biomeOverride`, les rivières et lacs dessinés creusent le relief. Les lieux viennent du
 * générateur (`placePlaces`), les routes d'un A* entre voisins (`findRoadPath`), scindées aux
 * coupures. Lancé à la main :
 *
 *   npx vite-node scripts/image-to-pangee.ts -- carte.png monde.pangee
 *
 * Voir docs/generation.md.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createNoise3D } from 'simplex-noise';
import { unzlibSync } from 'fflate';
import { Biome, computeBiomes, createClimateBuffers } from '@/climate';
import { computeHydro, riverThreshold } from '@/hydro';
import { MinHeap } from '@/hydro/heap';
import { placePlaces, distanceKm } from '@/gen/places';
import { findRoadPath, type LonLat } from '@/gen/roadPath';
import { fbmCylinder, ridgedCylinder } from '@/gen/noise';
import { mulberry32, hashSeed } from '@/gen/rng';
import { latOfRow, lonOfColumn, deltaLon, wrapLon } from '@/model/coords';
import { ringIndexOf, ringOf, type RingConfig } from '@/model/ring';
import { cultureOfLat, nameForPlace } from '@/gen/names';
import { parseWorld, serializeWorld } from '@/model/file';
import { fogSizeOf, RASTER_2K, type Place, type Road } from '@/model/world';

// --- Monde produit ------------------------------------------------------------------------------

const WORLD_NAME = 'Pangée';
const SEED = 'pangee-dessinee';
const RADIUS_KM = 6371;
const SEA_LEVEL_M = 0;
const PLACE_DENSITY = 0.75;

/**
 * Part de la largeur de l'image retirée à l'ouest et à l'est avant de l'étirer sur 360° : l'océan
 * des bords était trop large, les morceaux de continent y passaient l'essentiel de leur tour. Les
 * terres s'élargissent d'autant d'est en ouest, d'un facteur 1 / (1 − ouest − est).
 */
const CROP_WEST = 0.07;
const CROP_EAST = 0.17;

/**
 * Bandes de latitude du dessin retirées avant d'étirer le reste sur 180°, chacune `[nord, sud]`. Ce
 * sont les fonds des calottes, de la glace pleine : les terres en sont moins aplaties que par le seul
 * rognage est-ouest, sans perdre de mer.
 */
const REMOVED_BANDS_LAT: readonly (readonly [number, number])[] = [
  [90, 81],
  [-80, -90],
];

/** Degrés de bandes retirées au nord d'une latitude du dessin. */
function removedNorthOf(latDrawn: number): number {
  let deg = 0;
  for (const [north, south] of REMOVED_BANDS_LAT)
    deg += Math.max(0, north - Math.max(south, latDrawn));
  return deg;
}

/** Latitude du monde d'un point du dessin, une fois les bandes retirées. */
function worldLatOf(latDrawn: number): number {
  const kept = 180 - removedNorthOf(-90);
  return 90 - ((90 - latDrawn - removedNorthOf(latDrawn)) * 180) / kept;
}

/** Coupures placées sur le dessin, suivies dans le monde. */
const DRAWN_CUTS_LAT = [66, 40, 14, -8, -30, -62];

/**
 * Tous les anneaux tournent vers l'est, l'équateur en tête et les calottes en queue : deux voisins
 * ne glissent l'un contre l'autre que de 0,01 à 0,015 °/jour, un tour relatif en 66 à 99 ans, et les
 * continents restent longtemps face à face plutôt que de s'émietter en îles.
 */
const RING_CONFIG: RingConfig = {
  rings: [
    { id: 'boreal', name: 'Calotte boréale', omegaDegPerDay: 0.03 },
    { id: 'cimes', name: 'Anneau des Cimes', omegaDegPerDay: 0.04 },
    { id: 'lacs', name: 'Anneau des Lacs', omegaDegPerDay: 0.055 },
    { id: 'equator', name: 'Anneau équatorial', omegaDegPerDay: 0.07 },
    { id: 'jungles', name: 'Anneau des Jungles', omegaDegPerDay: 0.06 },
    { id: 'sables', name: 'Anneau des Sables', omegaDegPerDay: 0.045 },
    { id: 'austral', name: 'Calotte australe', omegaDegPerDay: 0.035 },
  ],
  cutsLat: DRAWN_CUTS_LAT.map((lat) => Math.round(worldLatOf(lat) * 10) / 10),
  t0: 0,
};

// --- Légende ------------------------------------------------------------------------------------

const C = {
  Unknown: 0,
  Ocean: 1,
  Ice: 2,
  Plain: 3,
  HighMountain: 4,
  Hills: 5,
  DenseForest: 6,
  AridSavanna: 7,
  TropicalGreen: 8,
  Steppe: 9,
  Forest: 10,
  Marsh: 11,
  Desert: 12,
  Water: 13,
} as const;

/** Couleurs de la carte source et classe associée. Les hachures et contours sont `Unknown`. */
const LEGEND: readonly (readonly [number, number, number, number])[] = [
  [0x45, 0xb0, 0xe1, C.Ocean],
  [0xff, 0xff, 0xff, C.Ice],
  [0x8e, 0xda, 0x74, C.Plain],
  [0xd4, 0xcd, 0xcd, C.HighMountain],
  [0xa5, 0xa5, 0xa5, C.Hills],
  [0x25, 0x55, 0x16, C.DenseForest],
  [0xfb, 0xb3, 0x44, C.AridSavanna],
  [0x4e, 0xa7, 0x2e, C.TropicalGreen],
  [0xad, 0xd4, 0x8d, C.Steppe],
  [0x3d, 0x55, 0x24, C.Forest],
  [0x9c, 0xcc, 0xb4, C.Marsh],
  [0xfd, 0xc4, 0x00, C.Desert],
  [0x5c, 0x9c, 0xd4, C.Water],
];
const MATCH_DIST2 = 30 * 30;

// --- Lecture PNG (8 bits, RVB ou RVBA, non entrelacé) -------------------------------------------

interface Rgb {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array; // RVB
}

function readPng(bytes: Uint8Array): Rgb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 3;
  const idat: Uint8Array[] = [];
  while (pos < bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const depth = body[8];
      const colorType = body[9];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0) {
        throw new Error('PNG non pris en charge : 8 bits RVB ou RVBA, non entrelacé.');
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const total = idat.reduce((n, b) => n + b.length, 0);
  const packed = new Uint8Array(total);
  let o = 0;
  for (const b of idat) {
    packed.set(b, o);
    o += b.length;
  }
  const raw = unzlibSync(packed);
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? pixels[dst + x - channels] : 0;
      const b = y > 0 ? pixels[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[dst - stride + x - channels] : 0;
      let p = raw[src + x];
      if (filter === 1) p += a;
      else if (filter === 2) p += b;
      else if (filter === 3) p += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[dst + x] = p & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i += 1, j += channels) {
    data[i * 3] = pixels[j]!;
    data[i * 3 + 1] = pixels[j + 1]!;
    data[i * 3 + 2] = pixels[j + 2]!;
  }
  return { width, height, data };
}

/** L'image privée de ses bords ouest et est, en parts de sa largeur. */
function cropColumns(img: Rgb, west: number, east: number): Rgb {
  const x0 = Math.round(img.width * west);
  const x1 = img.width - Math.round(img.width * east);
  const width = x1 - x0;
  const data = new Uint8Array(width * img.height * 3);
  for (let y = 0; y < img.height; y += 1) {
    data.set(img.data.subarray((y * img.width + x0) * 3, (y * img.width + x1) * 3), y * width * 3);
  }
  return { width, height: img.height, data };
}

/** L'image privée des lignes dont le centre tombe dans une bande retirée. */
function cropRows(img: Rgb): Rgb {
  const rows: number[] = [];
  for (let y = 0; y < img.height; y += 1) {
    const lat = 90 - ((y + 0.5) / img.height) * 180;
    if (!REMOVED_BANDS_LAT.some(([north, south]) => lat < north && lat > south)) rows.push(y);
  }
  const stride = img.width * 3;
  const data = new Uint8Array(rows.length * stride);
  rows.forEach((y, i) => data.set(img.data.subarray(y * stride, (y + 1) * stride), i * stride));
  return { width: img.width, height: rows.length, data };
}

// --- Classification -----------------------------------------------------------------------------

function classify(img: Rgb): Uint8Array {
  const n = img.width * img.height;
  const cls = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = img.data[i * 3];
    const g = img.data[i * 3 + 1];
    const b = img.data[i * 3 + 2];
    let best = C.Unknown as number;
    let bestD = MATCH_DIST2;
    for (const [lr, lg, lb, c] of LEGEND) {
      const d = (r - lr) ** 2 + (g - lg) ** 2 + (b - lb) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    cls[i] = best;
  }
  // Contours, hachures et anticrénelage : la classe majoritaire du voisinage, par passes.
  const counts = new Uint16Array(14);
  for (let pass = 0; pass < 6; pass += 1) {
    let left = 0;
    const next = cls.slice();
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const i = y * img.width + x;
        if (cls[i] !== C.Unknown) continue;
        counts.fill(0);
        for (let dy = -2; dy <= 2; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= img.height) continue;
          for (let dx = -2; dx <= 2; dx += 1) {
            const xx = (x + dx + img.width) % img.width;
            const c = cls[yy * img.width + xx];
            // Une hachure ne doit pas devenir une rivière : l'eau ne se propage pas.
            if (c !== C.Unknown && c !== C.Water) counts[c] += 1;
          }
        }
        let best = 0;
        for (let c = 1; c < counts.length; c += 1) if (counts[c] > counts[best]) best = c;
        if (best === 0) left += 1;
        next[i] = best;
      }
    }
    cls.set(next);
    if (left === 0) break;
  }
  return cls;
}

// --- Réduction à la grille du monde -------------------------------------------------------------

interface Grid {
  readonly cls: Uint8Array;
  /** Part de pixels d'eau douce dessinée dans la cellule : rivières et lacs. */
  readonly water: Float32Array;
  /** Part de pixels de lac seuls. */
  readonly lake: Float32Array;
}

/**
 * Eau dessinée épaisse : les lacs. Une rivière est un trait de deux ou trois pixels ; un lac a un
 * cœur à plus de deux pixels et demi de sa rive, et s'étend à toute l'eau qui l'entoure.
 */
function lakeMask(cls: Uint8Array, w: number, h: number): Uint8Array {
  const toShore = distanceInside((i) => cls[i] === C.Water, w, h);
  const toCore = distanceInside((i) => toShore[i] < 2.5, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) mask[i] = cls[i] === C.Water && toCore[i] <= 3 ? 1 : 0;
  return mask;
}

function downsample(
  cls: Uint8Array,
  lakes: Uint8Array,
  w: number,
  h: number,
  W: number,
  H: number,
): Grid {
  const out = new Uint8Array(W * H);
  const water = new Float32Array(W * H);
  const lake = new Float32Array(W * H);
  const counts = new Uint32Array(14);
  for (let y = 0; y < H; y += 1) {
    const y0 = Math.floor((y * h) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / H));
    for (let x = 0; x < W; x += 1) {
      const x0 = Math.floor((x * w) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / W));
      counts.fill(0);
      let lakePixels = 0;
      for (let sy = y0; sy < y1; sy += 1)
        for (let sx = x0; sx < x1; sx += 1) {
          counts[cls[sy * w + sx]] += 1;
          lakePixels += lakes[sy * w + sx];
        }
      const total = (y1 - y0) * (x1 - x0);
      let best = 0;
      for (let c = 1; c < counts.length; c += 1) {
        if (c === C.Water) continue;
        if (counts[c] > counts[best]) best = c;
      }
      // 0 : cellule entièrement couverte par une rivière, classée d'après ses voisines plus bas.
      out[y * W + x] = best;
      water[y * W + x] = counts[C.Water] / total;
      lake[y * W + x] = lakePixels / total;
    }
  }
  // Une cellule toute d'eau douce prend la classe terrestre dominante autour d'elle : jamais la
  // mer, sinon une rivière large deviendrait un bras de mer enclavé.
  const tally = new Uint16Array(14);
  for (let pass = 0; pass < 8; pass += 1) {
    let left = 0;
    for (let i = 0; i < W * H; i += 1) {
      if (out[i] !== 0) continue;
      const x = i % W;
      const y = (i - x) / W;
      tally.fill(0);
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx += 1) tally[out[yy * W + ((x + dx + W) % W)]] += 1;
      }
      let best = 0;
      for (let c = 2; c < tally.length; c += 1) if (tally[c] > tally[best]) best = c;
      if (best === 0) left += 1;
      else out[i] = best;
    }
    if (left === 0) break;
  }
  for (let i = 0; i < W * H; i += 1) if (out[i] === 0) out[i] = C.Plain;
  return { cls: out, water, lake };
}

// --- Distances (chanfrein 3-4, wrap est-ouest) --------------------------------------------------

/** Distance en cellules de chaque cellule `inside` à la plus proche cellule hors du masque. */
function distanceInside(inside: (i: number) => boolean, W: number, H: number): Float32Array {
  const d = new Float32Array(W * H);
  const BIG = 1e9;
  for (let i = 0; i < W * H; i += 1) d[i] = inside(i) ? BIG : 0;
  const relax = (i: number, j: number, cost: number): void => {
    const v = d[j] + cost;
    if (v < d[i]) d[i] = v;
  };
  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let y = 0; y < H; y += 1)
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        if (d[i] === 0) continue;
        const xl = (x - 1 + W) % W;
        const xr = (x + 1) % W;
        relax(i, y * W + xl, 3);
        if (y > 0) {
          relax(i, (y - 1) * W + x, 3);
          relax(i, (y - 1) * W + xl, 4);
          relax(i, (y - 1) * W + xr, 4);
        }
      }
    for (let y = H - 1; y >= 0; y -= 1)
      for (let x = W - 1; x >= 0; x -= 1) {
        const i = y * W + x;
        if (d[i] === 0) continue;
        const xl = (x - 1 + W) % W;
        const xr = (x + 1) % W;
        relax(i, y * W + xr, 3);
        if (y < H - 1) {
          relax(i, (y + 1) * W + x, 3);
          relax(i, (y + 1) * W + xl, 4);
          relax(i, (y + 1) * W + xr, 4);
        }
      }
  }
  for (let i = 0; i < W * H; i += 1) d[i] = Math.min(d[i], 4000) / 3;
  return d;
}

/** Part d'eau dessinée au-delà de laquelle une cellule est un lac plutôt qu'une rivière. */
const LAKE_SHARE = 0.3;

/** Priority-flood avec pente minimale `epsM`, amorcé par les cellules de mer. */
function fillToSea(
  height: Float32Array,
  isSea: (i: number) => boolean,
  W: number,
  H: number,
  epsM: number,
): void {
  const heap = new MinHeap(W * H);
  const done = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    if (!isSea(i)) continue;
    done[i] = 1;
    heap.push(SEA_LEVEL_M, i);
  }
  while (heap.size > 0) {
    const i = heap.pop();
    const x = i % W;
    const y = (i - x) / W;
    const base = isSea(i) ? SEA_LEVEL_M : height[i];
    for (let dy = -1; dy <= 1; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const j = yy * W + ((x + dx + W) % W);
        if (done[j]) continue;
        done[j] = 1;
        if (height[j] < base + epsM) height[j] = base + epsM;
        heap.push(height[j], j);
      }
    }
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// --- Relief -------------------------------------------------------------------------------------

function buildHeight(grid: Grid, W: number, H: number): Float32Array {
  const { cls, water, lake } = grid;
  const isSea = (i: number): boolean => cls[i] === C.Ocean;
  const isMountain = (i: number): boolean => cls[i] === C.HighMountain || cls[i] === C.Hills;
  const dLand = distanceInside((i) => !isSea(i), W, H);
  const dSea = distanceInside(isSea, W, H);
  const dMassif = distanceInside(isMountain, W, H);
  const dHigh = distanceInside((i) => cls[i] === C.HighMountain, W, H);

  const rng = mulberry32(hashSeed(SEED, 'relief'));
  const noise = createNoise3D(rng);
  const detail = { octaves: 6, frequency: 6, lacunarity: 2, persistence: 0.5 };
  const ridges = { octaves: 5, frequency: 9, lacunarity: 2.1, persistence: 0.5 };

  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    const lat = latOfRow(y, H);
    for (let x = 0; x < W; x += 1) {
      const lon = lonOfColumn(x, W);
      const i = y * W + x;
      const n = fbmCylinder(noise, lon, lat, detail);
      if (isSea(i)) {
        const shelf = 1 - Math.exp(-dSea[i] / 6);
        height[i] = -(60 + 4200 * shelf) * (1 + 0.15 * n) - 30;
        continue;
      }
      const coast = Math.min(dLand[i], 40);
      const inland = 15 + 10 * coast;
      let h: number;
      switch (cls[i]) {
        case C.Ice:
          h = 80 + 45 * coast + 150 * n;
          break;
        case C.Marsh:
          h = 4 + 1.5 * coast + 8 * n;
          break;
        case C.Desert:
          h = 120 + 9 * coast + 120 * n;
          break;
        case C.AridSavanna:
          h = 180 + 11 * coast + 150 * n;
          break;
        case C.Steppe:
          h = 120 + 9 * coast + 120 * n;
          break;
        case C.DenseForest:
        case C.Forest:
          h = inland + 180 + 200 * n;
          break;
        case C.TropicalGreen:
          h = inland + 60 + 150 * n;
          break;
        case C.Hills:
        case C.HighMountain: {
          const r = ridgedCylinder(noise, lon, lat, ridges);
          const massif = smoothstep(0, 5, dMassif[i]);
          const high = smoothstep(0, 9, dHigh[i]);
          h = inland + 300 + 1100 * massif + 2600 * high + (350 + 900 * high) * r;
          break;
        }
        default:
          h = inland + 100 * n;
      }
      height[i] = Math.max(3, h);
    }
  }

  // Lissage des terres seules : les marches entre classes deviennent des pentes.
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < H; y += 1)
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        if (isSea(i)) {
          tmp[i] = height[i]!;
          continue;
        }
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const j = yy * W + ((x + dx + W) % W);
            if (isSea(j)) continue;
            sum += height[j];
            count += 1;
          }
        }
        tmp[i] = Math.max(3, sum / count);
      }
    height.set(tmp);
  }

  // Rivières dessinées : des vallées qui attirent l'écoulement.
  for (let i = 0; i < W * H; i += 1) {
    if (isSea(i) || water[i] <= 0 || lake[i] > LAKE_SHARE) continue;
    height[i] = Math.max(2, height[i] * (0.85 - 0.25 * water[i]) - 8);
  }

  // Remplissage avec pente minimale depuis la mer : toute terre s'écoule vers la côte, aucun bassin
  // fermé ne devient un lac que la carte ne montre pas. La pente dépasse le pas de quantification
  // du fichier (0,32 m), sans quoi l'arrondi rouvrirait des cuvettes.
  fillToSea(height, isSea, W, H, 0.5);

  // Lacs dessinés : des cuvettes assez profondes pour que l'hydrologie les retienne.
  for (let i = 0; i < W * H; i += 1) {
    if (!isSea(i) && lake[i] > LAKE_SHARE) height[i] = Math.max(1, height[i] - 45);
  }
  return height;
}

// --- Biomes dessinés ----------------------------------------------------------------------------

function buildOverride(grid: Grid, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    const lat = Math.abs(latOfRow(y, H));
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      switch (grid.cls[i]) {
        case C.Ice:
          out[i] = Biome.Ice;
          break;
        case C.Desert:
          out[i] = Biome.Desert;
          break;
        case C.AridSavanna:
          out[i] = Biome.Savanna;
          break;
        case C.Marsh:
          out[i] = Biome.Marsh;
          break;
        case C.Steppe:
          out[i] = Biome.Steppe;
          break;
        case C.DenseForest:
          out[i] = lat < 25 ? Biome.TropicalRainforest : Biome.TemperateRainforest;
          break;
        case C.Forest:
          out[i] = lat > 45 ? Biome.Taiga : Biome.TemperateForest;
          break;
        case C.TropicalGreen:
          out[i] = Biome.TropicalForest;
          break;
        case C.Plain:
          // Les plaines dessinées sont vertes : la ceinture sèche des 25° n'en fera pas un désert.
          out[i] = lat < 20 ? Biome.TropicalForest : lat > 50 ? Biome.Taiga : Biome.TemperateForest;
          break;
        default:
          out[i] = Biome.Auto;
      }
    }
  }
  return out;
}

// --- Routes -------------------------------------------------------------------------------------

/** Coupe un tracé aux latitudes de coupure : une `Road` par anneau traversé. */
function splitAtCuts(points: readonly LonLat[], kind: Road['kind'], nextId: () => string): Road[] {
  const roads: Road[] = [];
  let current: LonLat[] = [points[0]];
  let ring = ringIndexOf(points[0][1], RING_CONFIG);
  for (let k = 1; k < points.length; k += 1) {
    const p = points[k - 1];
    const q = points[k];
    const qRing = ringIndexOf(q[1], RING_CONFIG);
    if (qRing !== ring) {
      // Une seule coupure franchie par pas de cellule : les coupures sont à plus d'un degré.
      const cut = RING_CONFIG.cutsLat[Math.min(ring, qRing)];
      const t = (cut - p[1]) / (q[1] - p[1]);
      const lon = wrapLon(p[0] + deltaLon(p[0], q[0]) * t);
      const north = cut + 1e-4;
      current.push(qRing > ring ? [lon, north] : [lon, cut]);
      if (current.length >= 2)
        roads.push({ id: nextId(), ringId: RING_CONFIG.rings[ring].id, points: current, kind });
      current = [qRing > ring ? [lon, cut] : [lon, north]];
      ring = qRing;
    }
    current.push(q);
  }
  if (current.length >= 2)
    roads.push({ id: nextId(), ringId: RING_CONFIG.rings[ring].id, points: current, kind });
  return roads;
}

function heightAt(height: Float32Array, W: number, H: number, [lon, lat]: LonLat): number {
  const x = Math.min(W - 1, Math.max(0, Math.floor(((wrapLon(lon) + 180) / 360) * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
  return height[y * W + x];
}

function buildRoads(
  places: readonly Place[],
  height: Float32Array,
  landOf: (p: Place) => number,
  W: number,
  H: number,
  nextId: () => string,
): Road[] {
  const nodes = places.filter((p) => p.kind !== 'volcano' && p.kind !== 'landmark');
  const dist = (a: Place, b: Place): number => distanceKm(a.lon, a.lat, b.lon, b.lat, RADIUS_KM);

  // Voisins proches, puis graphe de voisinage relatif : on écarte A–B si un tiers C est plus
  // proche des deux que A ne l'est de B. Un réseau ramifié plutôt qu'un maillage.
  const edges: [Place, Place, number][] = [];
  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      const A = nodes[a];
      const B = nodes[b];
      const d = dist(A, B);
      // Les traversées sont l'affaire des routes maritimes.
      if (landOf(A) !== landOf(B) || d > 500 + 150 * (A.size + B.size)) continue;
      let pruned = false;
      for (const Cn of nodes) {
        if (Cn === A || Cn === B) continue;
        if (Math.max(dist(A, Cn), dist(Cn, B)) < d) {
          pruned = true;
          break;
        }
      }
      if (!pruned) edges.push([A, B, d]);
    }
  }

  const roads: Road[] = [];
  for (const [A, B] of edges) {
    const path = findRoadPath({ width: W, height: H }, height, [A.lon, A.lat], [B.lon, B.lat], {
      radiusKm: RADIUS_KM,
      seaLevelM: SEA_LEVEL_M,
      maxCells: 3_000_000,
    });
    if (!path || path.length < 2) continue;
    // Part du tracé sous la mer, échantillonnée le long des segments.
    let wet = 0;
    let samples = 0;
    for (let k = 1; k < path.length; k += 1) {
      for (let s = 0; s < 4; s += 1) {
        const t = s / 4;
        const p = path[k - 1];
        const q = path[k];
        const pt: LonLat = [p[0] + deltaLon(p[0], q[0]) * t, p[1] + (q[1] - p[1]) * t];
        if (heightAt(height, W, H, pt) <= SEA_LEVEL_M) wet += 1;
        samples += 1;
      }
    }
    const wetShare = wet / samples;
    let kind: Road['kind'];
    if (wetShare > 0.15) {
      if (Math.min(A.size, B.size) < 2) continue;
      kind = 'sea-route';
    } else if (Math.min(A.size, B.size) >= 2 && Math.max(A.size, B.size) >= 3) kind = 'road';
    else kind = 'path';
    roads.push(...splitAtCuts(path, kind, nextId));
  }
  return roads;
}

// --- Terres et îles -----------------------------------------------------------------------------

/**
 * Composantes connexes de terre habitable (4-voisinage, wrap est-ouest) ; 0 = mer ou glace. La
 * glace sépare : sans quoi la banquise polaire souderait toutes les terres du nord en une seule.
 */
function labelLand(grid: Grid, W: number, H: number): { label: Int32Array; area: number[] } {
  const label = new Int32Array(W * H);
  const area = [0];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start += 1) {
    if (grid.cls[start] === C.Ocean || grid.cls[start] === C.Ice || label[start]) continue;
    const id = area.length;
    area.push(0);
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      area[id] += 1;
      const x = i % W;
      const y = (i - x) / W;
      const next = [y * W + ((x + 1) % W), y * W + ((x - 1 + W) % W)];
      if (y > 0) next.push(i - W);
      if (y < H - 1) next.push(i + W);
      for (const j of next) {
        if (grid.cls[j] === C.Ocean || grid.cls[j] === C.Ice || label[j]) continue;
        label[j] = id;
        stack.push(j);
      }
    }
  }
  return { label, area };
}

function cellOf(W: number, H: number, lon: number, lat: number): number {
  const x = Math.min(W - 1, Math.max(0, Math.floor(((wrapLon(lon) + 180) / 360) * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
  return y * W + x;
}

/**
 * Le placement favorise les grands fleuves, que les îles n'ont pas : chaque terre habitable reçoit
 * au moins quelques lieux, de préférence sur la côte, comme des ports.
 */
function addIslandPlaces(
  places: readonly Place[],
  grid: Grid,
  height: Float32Array,
  land: { label: Int32Array; area: number[] },
  W: number,
  H: number,
): Place[] {
  const out = [...places];
  const rng = mulberry32(hashSeed(SEED, 'places'));
  const toSea = distanceInside((i) => grid.cls[i] !== C.Ocean, W, H);
  for (let id = 1; id < land.area.length; id += 1) {
    const area = land.area[id];
    if (area < 600) continue;
    const target = Math.min(7, Math.max(1, Math.round(area / 4000)));
    const inside = out.filter((p) => land.label[cellOf(W, H, p.lon, p.lat)] === id);
    let count = inside.length;
    // Une terre sans ville ni bourg n'a rien de visible à petite échelle : il lui faut un port.
    let needsHub = !inside.some((p) => p.size >= 2);
    if (count >= target && !needsHub) continue;

    const candidates: [number, number][] = [];
    for (let i = 0; i < W * H; i += 1) {
      if (land.label[i] !== id) continue;
      const c = grid.cls[i];
      if (c === C.Ice || c === C.HighMountain) continue;
      const h = height[i];
      if (h < 5 || h > 900) continue;
      const coast = toSea[i];
      if (coast < 1 || coast > 10) continue;
      const score = 1 / (1 + Math.abs(coast - 2)) + 0.6 * grid.water[i] + 0.4 * rng();
      candidates.push([score, i]);
    }
    candidates.sort((a, b) => b[0] - a[0]);

    for (const [, i] of candidates) {
      if (count >= target && !needsHub) break;
      const x = i % W;
      const y = (i - x) / W;
      const lon = lonOfColumn(x, W);
      const lat = latOfRow(y, H);
      const spacingKm = needsHub ? 180 : 320;
      if (out.some((p) => distanceKm(p.lon, p.lat, lon, lat, RADIUS_KM) < spacingKm)) continue;
      const size = (needsHub ? (area > 6000 ? 3 : 2) : count % 3 === 1 ? 2 : 1) as Place['size'];
      needsHub = false;
      const placeId = `place-${out.length}`;
      out.push({
        id: placeId,
        ringId: ringOf(lat, RING_CONFIG),
        lon,
        lat,
        name: nameForPlace(cultureOfLat(lat), hashSeed(`${SEED}:${placeId}`, 'names')),
        kind: size >= 3 ? 'city' : size === 2 ? 'town' : 'village',
        size,
      });
      count += 1;
    }
  }
  return out;
}

/** Trajet maritime de moindre coût : la mer coûte sa longueur, la terre quarante fois plus. */
function seaPath(
  height: Float32Array,
  W: number,
  H: number,
  from: LonLat,
  to: LonLat,
): LonLat[] | undefined {
  const fx = Math.floor(((wrapLon(from[0]) + 180) / 360) * W);
  const fy = Math.floor(((90 - from[1]) / 180) * H);
  const tx = Math.floor(((wrapLon(to[0]) + 180) / 360) * W);
  const ty = Math.floor(((90 - to[1]) / 180) * H);
  let du = (((tx - fx) % W) + W) % W;
  if (du > W / 2) du -= W;
  const margin = 30;
  const u0 = Math.min(0, du) - margin;
  const v0 = Math.max(0, Math.min(fy, ty) - margin);
  const cols = Math.abs(du) + 2 * margin + 1;
  const rows = Math.min(H - 1, Math.max(fy, ty) + margin) - v0 + 1;
  const n = cols * rows;
  const cost = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap(n);
  const local = (u: number, y: number): number => (y - v0) * cols + (u - u0);
  const startK = local(0, fy);
  const goalK = local(du, ty);
  cost[startK] = 0;
  heap.push(0, startK);
  while (heap.size > 0) {
    const k = heap.pop();
    if (k === goalK) break;
    const u = (k % cols) + u0;
    const y = Math.floor(k / cols) + v0;
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const uu = u + dx;
        const yy = y + dy;
        if (uu < u0 || uu >= u0 + cols || yy < v0 || yy >= v0 + rows) continue;
        const h = height[yy * W + ((((fx + uu) % W) + W) % W)];
        const step = (dx && dy ? Math.SQRT2 : 1) * (h <= SEA_LEVEL_M ? 1 : 40);
        const kk = local(uu, yy);
        const c = cost[k] + step;
        if (c < cost[kk]) {
          cost[kk] = c;
          prev[kk] = k;
          heap.push(c, kk);
        }
      }
  }
  if (prev[goalK] === -1) return undefined;
  const cells: number[] = [];
  for (let k = goalK; k !== -1; k = prev[k]!) cells.push(k);
  cells.reverse();
  const points: LonLat[] = [from];
  for (let m = 3; m < cells.length - 3; m += 3) {
    const k = cells[m];
    const u = (k % cols) + u0;
    const y = Math.floor(k / cols) + v0;
    points.push([lonOfColumn((((fx + u) % W) + W) % W, W), latOfRow(y, H)]);
  }
  points.push(to);
  return points;
}

/** Chaque île est reliée par la mer, depuis son lieu principal, au port le plus proche d'une autre terre. */
function buildSeaRoutes(
  places: readonly Place[],
  height: Float32Array,
  land: { label: Int32Array; area: number[] },
  W: number,
  H: number,
  nextId: () => string,
): Road[] {
  const landOf = (p: Place): number => land.label[cellOf(W, H, p.lon, p.lat)];
  const largest = land.area.indexOf(Math.max(...land.area.slice(1)));
  const roads: Road[] = [];
  for (let id = 1; id < land.area.length; id += 1) {
    if (id === largest) continue;
    const local = places.filter((p) => landOf(p) === id && p.size >= 2);
    if (local.length === 0) continue;
    const hub = local.reduce((a, b) => (b.size > a.size ? b : a));
    let best: Place | undefined;
    let bestD = 3000;
    for (const p of places) {
      if (landOf(p) === id || p.size < 2) continue;
      const d = distanceKm(hub.lon, hub.lat, p.lon, p.lat, RADIUS_KM);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) continue;
    const path = seaPath(height, W, H, [hub.lon, hub.lat], [best.lon, best.lat]);
    if (path) roads.push(...splitAtCuts(path, 'sea-route', nextId));
  }
  return roads;
}

/** Le générateur de noms se répète sur cent lieux : un doublon reçoit un autre tirage. */
function withUniqueNames(places: readonly Place[]): Place[] {
  const used = new Set<string>();
  return places.map((p) => {
    let name = p.name;
    for (let k = 1; used.has(name) && k < 50; k += 1) {
      name = nameForPlace(cultureOfLat(p.lat), hashSeed(`${SEED}:${p.id}:${k}`, 'names'));
    }
    used.add(name);
    return name === p.name ? p : { ...p, name };
  });
}

// --- Assemblage ---------------------------------------------------------------------------------

function main(): void {
  const [input, output] = process.argv.slice(2).filter((a) => a !== '--');
  if (!input || !output) throw new Error('Usage : image-to-pangee <carte.png> <monde.pangee>');

  const size = RASTER_2K;
  const { width: W, height: H } = size;
  const img = cropRows(cropColumns(readPng(readFileSync(input)), CROP_WEST, CROP_EAST));
  console.log(`Coupures ${RING_CONFIG.cutsLat.join(' · ')}`);
  console.log(`Image ${img.width}×${img.height}`);
  const cls = classify(img);
  const grid = downsample(cls, lakeMask(cls, img.width, img.height), img.width, img.height, W, H);

  const height = buildHeight(grid, W, H);
  const biomeOverride = buildOverride(grid, W, H);

  const rainPerCell = 1;
  const hydro = computeHydro({ size, heightWorld: height, seaLevelM: SEA_LEVEL_M, rainPerCell });
  const threshold = riverThreshold(size, rainPerCell);
  const biome = computeBiomes(
    {
      size,
      heightWorld: height,
      waterLevel: hydro.waterLevel,
      flowAcc: hydro.flowAcc,
      seaLevelM: SEA_LEVEL_M,
      riverThreshold: threshold,
      seed: SEED,
    },
    createClimateBuffers(size),
  );
  for (let i = 0; i < biome.length; i += 1) if (biomeOverride[i]) biome[i] = biomeOverride[i]!;

  const generated = placePlaces({
    size,
    heightWorld: height,
    waterLevel: hydro.waterLevel,
    flowAcc: hydro.flowAcc,
    biome,
    seaLevelM: SEA_LEVEL_M,
    riverThreshold: threshold,
    radiusKm: RADIUS_KM,
    ringConfig: RING_CONFIG,
    seed: SEED,
    placeDensity: PLACE_DENSITY,
  });
  const land = labelLand(grid, W, H);
  const allPlaces = addIslandPlaces(generated, grid, height, land, W, H);
  const landOf = (p: Place): number => land.label[cellOf(W, H, p.lon, p.lat)];
  let roadCount = 0;
  const nextId = (): string => `road-${(roadCount += 1)}`;
  const roads = [
    ...buildRoads(allPlaces, height, landOf, W, H, nextId),
    ...buildSeaRoutes(allPlaces, height, land, W, H, nextId),
  ];
  const places = withUniqueNames(allPlaces);

  const fogSize = fogSizeOf(size);
  const bytes = serializeWorld(
    {
      id: `world-${hashSeed(SEED, 'relief').toString(36)}`,
      name: WORLD_NAME,
      seed: SEED,
      ringConfig: RING_CONFIG,
      radiusKm: RADIUS_KM,
      seaLevelM: SEA_LEVEL_M,
      campaignDate: 0,
      size,
      height,
      biomeOverride,
      fogSize,
      fog: new Uint8Array(fogSize.width * fogSize.height),
      places,
      roads,
      creatures: [],
    },
    { heightEncoding: 'uint16' },
  );
  const check = parseWorld(bytes);
  if (!check.ok) throw new Error(`Fichier produit illisible : ${check.error}`);
  writeFileSync(output, bytes);

  const byKind = new Map<string, number>();
  for (const p of places) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
  const byRoad = new Map<string, number>();
  for (const r of roads) byRoad.set(r.kind, (byRoad.get(r.kind) ?? 0) + 1);
  console.log(
    `${places.length} lieux (${[...byKind].map(([k, v]) => `${v} ${k}`).join(', ')}), ` +
      `${roads.length} tronçons (${[...byRoad].map(([k, v]) => `${v} ${k}`).join(', ')}), ` +
      `${hydro.lakes.length} lacs → ${output} (${(bytes.length / 1e6).toFixed(1)} Mo)`,
  );
}

main();

/**
 * Préparation d'un export PNG : taille de l'image, garde-fou mémoire, échelle
 * graphique, place de la mention « Terra incognita ».
 *
 * Aucun appel au GPU ici : ce sont des calculs, testables sans navigateur.
 * Voir docs/partage.md.
 */

import { kmPerDegLon } from '@/model/coords';
import type { WorldRect } from '@/model/viewport';

/** Largeur maximale proposée au MJ, en pixels. */
export const MAX_EXPORT_WIDTH_PX = 8000;

/**
 * Budget mémoire d'un export : la cible du rendu, la copie extraite et le
 * canvas des décorations, quatre octets par pixel chacun.
 */
export const MAX_EXPORT_BYTES = 512 * 1024 * 1024;
const COPIES = 3;

export interface ExportPlan {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelsPerDegree: number;
  readonly bytes: number;
}

export type ExportPlanResult =
  | { readonly ok: true; readonly value: ExportPlan }
  | { readonly ok: false; readonly error: string; readonly suggestedWidthPx?: number };

/**
 * Taille de l'image pour un cadre et une largeur demandée. La hauteur découle
 * du rapport d'aspect du cadre, à projection équirectangulaire constante.
 *
 * Refuse plutôt que de faire planter l'onglet, et propose alors la plus grande
 * largeur qui passe.
 */
export function planExport(
  rect: WorldRect,
  widthPx: number,
  maxTextureSizePx: number,
): ExportPlanResult {
  if (rect.widthDeg <= 0 || rect.heightDeg <= 0) {
    return { ok: false, error: 'Le cadre est vide : tracez un rectangle sur la carte.' };
  }

  const width = Math.round(widthPx);
  if (!Number.isFinite(width) || width < 16) {
    return { ok: false, error: 'La largeur doit dépasser 16 pixels.' };
  }

  const aspect = rect.heightDeg / rect.widthDeg;
  const height = Math.max(1, Math.round(width * aspect));
  const bytes = width * height * 4 * COPIES;

  // La plus grande largeur qui tient à la fois dans la mémoire, dans la
  // texture du GPU et sous le plafond proposé au MJ.
  const byMemory = Math.floor(Math.sqrt(MAX_EXPORT_BYTES / (4 * COPIES * aspect)));
  const byTexture = Math.floor(Math.min(maxTextureSizePx, maxTextureSizePx / aspect));
  const largest = Math.min(byMemory, byTexture, MAX_EXPORT_WIDTH_PX);

  if (width > largest) {
    const why =
      largest === byTexture
        ? `la carte graphique ne rend pas d'image de plus de ${maxTextureSizePx} pixels de côté`
        : largest === byMemory
          ? `l'image demanderait ${Math.round(bytes / 1024 / 1024)} Mio de mémoire`
          : `la largeur est plafonnée à ${MAX_EXPORT_WIDTH_PX} pixels`;
    return {
      ok: false,
      error: `Export trop grand (${width} × ${height} px) : ${why}.`,
      suggestedWidthPx: largest,
    };
  }

  return {
    ok: true,
    value: { widthPx: width, heightPx: height, pixelsPerDegree: width / rect.widthDeg, bytes },
  };
}

/**
 * Largeur d'image à laquelle libellés, icônes et traits gardent leur taille
 * d'écran. Au-delà, la scène est rendue sur cette largeur logique puis
 * agrandie : un export de 8000 pixels reste lisible, au lieu de montrer des
 * noms de dix pixels perdus dans l'image.
 */
export const ORNAMENT_REFERENCE_WIDTH_PX = 1600;

/** Facteur d'agrandissement des ornements pour une largeur d'export donnée. */
export function ornamentScale(widthPx: number): number {
  return Math.max(1, widthPx / ORNAMENT_REFERENCE_WIDTH_PX);
}

export interface ScaleBar {
  readonly km: number;
  readonly lengthPx: number;
}

/**
 * Barre d'échelle d'une longueur « ronde » (1, 2 ou 5 × 10ⁿ km), au plus
 * `maxLengthPx` pixels. Calibrée sur la latitude médiane du cadre, donc exacte
 * seulement en son milieu : la projection est équirectangulaire.
 */
export function scaleBar(
  rect: WorldRect,
  pixelsPerDegree: number,
  radiusKm: number,
  maxLengthPx: number,
): ScaleBar {
  const midLat = rect.latNorth - rect.heightDeg / 2;
  const kmPerPx = kmPerDegLon(midLat, radiusKm) / pixelsPerDegree;
  const maxKm = maxLengthPx * kmPerPx;

  const magnitude = 10 ** Math.floor(Math.log10(maxKm));
  const km =
    [5, 2, 1].map((m) => m * magnitude).find((candidate) => candidate <= maxKm) ?? magnitude;
  return { km, lengthPx: km / kmPerPx };
}

/**
 * Point de l'image le plus éloigné de toute zone révélée, s'il est assez loin
 * pour y écrire « Terra incognita ».
 *
 * `revealedAt(x, y)` renvoie la part révélée (0 à 1) au pixel donné. On
 * l'échantillonne sur une grille grossière, puis une transformée de distance
 * en deux passes donne, pour chaque case inconnue, l'éloignement du connu.
 */
export function terraIncognitaSpot(
  widthPx: number,
  heightPx: number,
  revealedAt: (xPx: number, yPx: number) => number,
  minClearancePx: number,
): { readonly x: number; readonly y: number } | undefined {
  const cellPx = Math.max(8, Math.ceil(Math.max(widthPx, heightPx) / 96));
  const cols = Math.ceil(widthPx / cellPx);
  const rows = Math.ceil(heightPx / cellPx);
  const far = cols + rows;
  const distance = new Float32Array(cols * rows);

  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const known = revealedAt((i + 0.5) * cellPx, (j + 0.5) * cellPx) > 0.5;
      distance[j * cols + i] = known ? 0 : far;
    }
  }

  // Le bord de l'image compte comme du connu : un libellé qui en déborderait
  // serait coupé.
  const at = (i: number, j: number): number =>
    i < 0 || j < 0 || i >= cols || j >= rows ? 0 : distance[j * cols + i]!;

  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const k = j * cols + i;
      distance[k] = Math.min(distance[k]!, at(i - 1, j) + 1, at(i, j - 1) + 1);
    }
  }
  for (let j = rows - 1; j >= 0; j -= 1) {
    for (let i = cols - 1; i >= 0; i -= 1) {
      const k = j * cols + i;
      distance[k] = Math.min(distance[k]!, at(i + 1, j) + 1, at(i, j + 1) + 1);
    }
  }

  let best = -1;
  let bestDistance = 0;
  for (let k = 0; k < distance.length; k += 1) {
    if (distance[k]! > bestDistance) {
      bestDistance = distance[k]!;
      best = k;
    }
  }

  if (best === -1 || bestDistance * cellPx < minClearancePx) return undefined;
  const i = best % cols;
  return { x: (i + 0.5) * cellPx, y: ((best - i) / cols + 0.5) * cellPx };
}

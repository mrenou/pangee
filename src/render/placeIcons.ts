/**
 * Icônes de lieux.
 *
 * Même parti pris que les symboles de relief : des chemins, pas des fichiers.
 * Chaque figure est tracée centrée sur (x, y), l'axe y vers le haut.
 * Voir docs/rendu.md.
 */

import type { Graphics } from 'pixi.js';
import type { PlaceKind } from '@/model/world';

const INK = 0x2b2118;
const FILL = 0xf2e8d0;

/** Ville : une enceinte crénelée, la figure la plus lourde de la carte. */
function drawCity(g: Graphics, x: number, y: number, r: number): void {
  const w = r * 1.5;
  const h = r * 1.2;
  g.rect(x - w / 2, y - h / 2, w, h).fill({ color: FILL, alpha: 0.95 });

  // Créneaux : trois dents sur le faîte.
  for (let i = -1; i <= 1; i += 1) {
    g.rect(x + i * (w / 3) - w / 10, y + h / 2, w / 5, h / 3).fill({ color: FILL, alpha: 0.95 });
  }
  g.rect(x - w / 2, y - h / 2, w, h).stroke({ width: r * 0.22, color: INK, alpha: 0.9 });
}

/** Bourg : un cercle cerclé. */
function drawTown(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x, y, r * 0.75)
    .fill({ color: FILL, alpha: 0.95 })
    .stroke({ width: r * 0.24, color: INK, alpha: 0.9 });
}

/** Village : un point plein, discret. */
function drawVillage(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x, y, r * 0.42).fill({ color: INK, alpha: 0.8 });
}

/** Forteresse : une tour flanquée de deux merlons. */
function drawFortress(g: Graphics, x: number, y: number, r: number): void {
  const w = r * 1.1;
  g.rect(x - w / 2, y - r * 0.5, w, r * 1.2)
    .fill({ color: FILL, alpha: 0.95 })
    .stroke({ width: r * 0.2, color: INK, alpha: 0.9 });
  g.moveTo(x, y + r * 0.7)
    .lineTo(x, y + r * 1.15)
    .stroke({ width: r * 0.18, color: INK, alpha: 0.9 });
}

/** Ruine : deux fûts brisés, de hauteurs inégales. */
function drawRuin(g: Graphics, x: number, y: number, r: number): void {
  g.moveTo(x - r * 0.45, y - r * 0.5)
    .lineTo(x - r * 0.45, y + r * 0.55)
    .moveTo(x + r * 0.3, y - r * 0.5)
    .lineTo(x + r * 0.3, y + r * 0.2)
    .moveTo(x - r * 0.7, y - r * 0.5)
    .lineTo(x + r * 0.6, y - r * 0.5)
    .stroke({ width: r * 0.22, color: INK, alpha: 0.85, cap: 'round' });
}

/** Volcan : un cône tronqué et son panache. */
function drawVolcano(g: Graphics, x: number, y: number, r: number): void {
  g.moveTo(x - r * 0.8, y - r * 0.5)
    .lineTo(x - r * 0.25, y + r * 0.6)
    .lineTo(x + r * 0.25, y + r * 0.6)
    .lineTo(x + r * 0.8, y - r * 0.5)
    .stroke({ width: r * 0.22, color: INK, alpha: 0.9, join: 'round' });
  g.moveTo(x - r * 0.15, y + r * 0.75)
    .lineTo(x, y + r * 1.2)
    .lineTo(x + r * 0.2, y + r * 0.8)
    .stroke({ width: r * 0.16, color: 0x8a4b3a, alpha: 0.7, cap: 'round' });
}

/** Repère : un losange, pour ce qui n'est ni habité ni ruiné. */
function drawLandmark(g: Graphics, x: number, y: number, r: number): void {
  g.moveTo(x, y + r * 0.75)
    .lineTo(x + r * 0.6, y)
    .lineTo(x, y - r * 0.75)
    .lineTo(x - r * 0.6, y)
    .closePath()
    .fill({ color: FILL, alpha: 0.9 })
    .stroke({ width: r * 0.2, color: INK, alpha: 0.9 });
}

const DRAW: Readonly<Record<PlaceKind, (g: Graphics, x: number, y: number, r: number) => void>> = {
  city: drawCity,
  town: drawTown,
  village: drawVillage,
  fortress: drawFortress,
  ruin: drawRuin,
  volcano: drawVolcano,
  landmark: drawLandmark,
};

export function drawPlaceIcon(
  g: Graphics,
  kind: PlaceKind,
  x: number,
  y: number,
  radiusPx: number,
): void {
  DRAW[kind](g, x, y, radiusPx);
}

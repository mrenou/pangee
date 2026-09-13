/**
 * Symboles de relief, dessinés au trait.
 *
 * Pas de fichiers SVG : les figures sont tracées en chemins, ce qui les rend
 * lisibles, modifiables et sans chargement. Chaque fonction dessine dans un
 * repère centré en (0, 0), d'une unité de haut, l'axe y vers le haut.
 * Voir docs/rendu.md.
 */

import type { Graphics } from 'pixi.js';

export const INK = 0x3a2e22;
export const INK_LIGHT = 0x6b5a45;
export const FOLIAGE = 0x4e5c3e;

/**
 * Montagne : deux versants et une arête, comme les chevrons des cartes
 * gravées. Le versant droit est ombré de hachures, le gauche reste clair —
 * une lumière venue du nord-ouest, la même que celle du terrain.
 */
export function drawMountain(g: Graphics, x: number, y: number, size: number, lean: number): void {
  const h = size;
  const w = size * 0.85;
  const apexX = x + lean * w * 0.18;

  // Versant ombré, rempli en premier pour que le trait passe par-dessus.
  g.moveTo(apexX, y + h)
    .lineTo(x + w * 0.5, y)
    .lineTo(x + w * 0.12, y)
    .closePath()
    .fill({ color: INK_LIGHT, alpha: 0.28 });

  g.moveTo(x - w * 0.5, y)
    .lineTo(apexX, y + h)
    .lineTo(x + w * 0.5, y)
    .stroke({ width: size * 0.1, color: INK, alpha: 0.85, join: 'round', cap: 'round' });

  // L'arête qui descend du sommet : c'est elle qui donne le volume.
  g.moveTo(apexX, y + h)
    .lineTo(x + w * 0.1, y)
    .stroke({ width: size * 0.07, color: INK, alpha: 0.5, cap: 'round' });
}

/** Colline : un simple dos arrondi, plus bas et plus large qu'une montagne. */
export function drawHill(g: Graphics, x: number, y: number, size: number): void {
  const w = size * 0.9;
  const h = size * 0.5;
  g.moveTo(x - w * 0.5, y)
    .bezierCurveTo(x - w * 0.28, y + h * 1.5, x + w * 0.28, y + h * 1.5, x + w * 0.5, y)
    .stroke({ width: size * 0.09, color: INK, alpha: 0.7, cap: 'round' });
}

/** Arbre : un tronc court et un houppier en trois lobes. */
export function drawTree(g: Graphics, x: number, y: number, size: number): void {
  const trunk = size * 0.3;
  g.moveTo(x, y)
    .lineTo(x, y + trunk)
    .stroke({ width: size * 0.1, color: INK, alpha: 0.8, cap: 'round' });

  const r = size * 0.3;
  g.circle(x, y + trunk + r * 0.7, r)
    .circle(x - r * 0.75, y + trunk + r * 0.15, r * 0.7)
    .circle(x + r * 0.75, y + trunk + r * 0.15, r * 0.7)
    .fill({ color: FOLIAGE, alpha: 0.5 });
}

/** Conifère : une flèche, pour distinguer la taïga de la forêt tempérée. */
export function drawConifer(g: Graphics, x: number, y: number, size: number): void {
  const w = size * 0.42;
  g.moveTo(x, y)
    .lineTo(x, y + size)
    .stroke({ width: size * 0.09, color: INK, alpha: 0.8, cap: 'round' });

  for (let tier = 0; tier < 3; tier += 1) {
    const ty = y + size * (0.25 + tier * 0.24);
    const tw = w * (1 - tier * 0.24);
    g.moveTo(x - tw, ty)
      .lineTo(x, ty + size * 0.3)
      .lineTo(x + tw, ty)
      .closePath()
      .fill({ color: FOLIAGE, alpha: 0.45 });
  }
}

/** Dune : deux croissants, pour le désert. */
export function drawDune(g: Graphics, x: number, y: number, size: number): void {
  const w = size * 0.75;
  g.moveTo(x - w * 0.5, y)
    .bezierCurveTo(x - w * 0.2, y + size * 0.45, x + w * 0.15, y + size * 0.3, x + w * 0.5, y)
    .stroke({ width: size * 0.08, color: INK_LIGHT, alpha: 0.6, cap: 'round' });
}

/** Marais : des herbes sur deux traits d'eau. */
export function drawMarsh(g: Graphics, x: number, y: number, size: number): void {
  const w = size * 0.7;
  for (let line = 0; line < 2; line += 1) {
    const ly = y + line * size * 0.28;
    g.moveTo(x - w * 0.5, ly)
      .lineTo(x + w * 0.5, ly)
      .stroke({ width: size * 0.07, color: 0x5d7078, alpha: 0.7, cap: 'round' });
  }
  g.moveTo(x, y + size * 0.28)
    .lineTo(x, y + size * 0.7)
    .stroke({ width: size * 0.07, color: 0x5d7078, alpha: 0.6, cap: 'round' });
}

/**
 * Symboles de relief, dessinés au trait.
 *
 * Les figures sont tracées en chemins plutôt qu'en fichiers : lisibles,
 * modifiables, sans chargement.
 *
 * Elles sont émises **par passes de style** et non une par une. Chaque appel à
 * `stroke` ou `fill` de PixiJS ouvre une instruction de dessin : en terminant
 * chaque symbole, on en produisait deux ou trois milliers par image, et le zoom
 * perdait quarante pour cent de sa fluidité. On accumule donc tous les chemins
 * d'un même style, puis on les referme d'un seul trait.
 *
 * Contrepartie : l'épaisseur est commune à une passe. Les tailles continuent de
 * varier par la géométrie, ce qui suffit à éviter l'effet d'impression.
 * Voir docs/rendu.md.
 */

import type { Graphics } from 'pixi.js';

export const INK = 0x3a2e22;
export const INK_LIGHT = 0x6b5a45;
export const FOLIAGE = 0x4e5c3e;
const WATER = 0x5d7078;

/** Nombre de segments d'une courbe échantillonnée. Voir docs/rendu.md. */
const ARC_STEPS = 12;

export type SymbolKind = 'mountain' | 'hill' | 'tree' | 'conifer' | 'dune' | 'marsh';

export interface PlacedSymbol {
  readonly kind: SymbolKind;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** Penche le sommet d'une montagne à gauche ou à droite. */
  readonly lean: number;
}

/**
 * Les passes, dans l'ordre de superposition : les aplats d'abord, les traits
 * par-dessus.
 */
export const SYMBOL_PASSES = ['shade', 'foliage', 'ink', 'ridge', 'sand', 'water'] as const;
export type SymbolPass = (typeof SYMBOL_PASSES)[number];

/** Referme une passe avec son style. `unit` est la taille moyenne d'un symbole. */
export function closePass(g: Graphics, pass: SymbolPass, unit: number): void {
  switch (pass) {
    case 'shade':
      g.fill({ color: INK_LIGHT, alpha: 0.28 });
      break;
    case 'foliage':
      g.fill({ color: FOLIAGE, alpha: 0.48 });
      break;
    case 'ink':
      g.stroke({ width: unit * 0.1, color: INK, alpha: 0.85, join: 'round', cap: 'round' });
      break;
    case 'ridge':
      g.stroke({ width: unit * 0.07, color: INK, alpha: 0.5, cap: 'round' });
      break;
    case 'sand':
      g.stroke({ width: unit * 0.08, color: INK_LIGHT, alpha: 0.6, cap: 'round' });
      break;
    case 'water':
      g.stroke({ width: unit * 0.07, color: WATER, alpha: 0.65, cap: 'round' });
      break;
  }
}

function cubic(
  g: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): void {
  g.moveTo(x0, y0);
  for (let k = 1; k <= ARC_STEPS; k += 1) {
    const t = k / ARC_STEPS;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    g.lineTo(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
  }
}

function disc(g: Graphics, cx: number, cy: number, r: number): void {
  g.moveTo(cx + r, cy);
  for (let k = 1; k <= ARC_STEPS; k += 1) {
    const angle = (k / ARC_STEPS) * Math.PI * 2;
    g.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  g.closePath();
}

/**
 * Trace les chemins d'un symbole qui appartiennent à cette passe.
 * Ne referme rien : c'est `closePass` qui s'en charge, une fois pour toutes.
 */
export function emitSymbol(g: Graphics, s: PlacedSymbol, pass: SymbolPass): void {
  const { x, y, size } = s;

  switch (s.kind) {
    case 'mountain': {
      const w = size * 0.85;
      const apexX = x + s.lean * w * 0.18;
      if (pass === 'shade') {
        // Versant à l'ombre, sous une lumière venue du nord-ouest.
        g.moveTo(apexX, y + size)
          .lineTo(x + w * 0.5, y)
          .lineTo(x + w * 0.12, y)
          .closePath();
      } else if (pass === 'ink') {
        g.moveTo(x - w * 0.5, y)
          .lineTo(apexX, y + size)
          .lineTo(x + w * 0.5, y);
      } else if (pass === 'ridge') {
        // L'arête qui descend du sommet : c'est elle qui donne le volume.
        g.moveTo(apexX, y + size).lineTo(x + w * 0.1, y);
      }
      break;
    }

    case 'hill': {
      if (pass !== 'ink') break;
      const w = size * 0.9;
      const h = size * 0.5;
      cubic(
        g,
        x - w * 0.5,
        y,
        x - w * 0.28,
        y + h * 1.5,
        x + w * 0.28,
        y + h * 1.5,
        x + w * 0.5,
        y,
      );
      break;
    }

    case 'tree': {
      const trunk = size * 0.3;
      const r = size * 0.3;
      if (pass === 'ink') {
        g.moveTo(x, y).lineTo(x, y + trunk);
      } else if (pass === 'foliage') {
        disc(g, x, y + trunk + r * 0.7, r);
        disc(g, x - r * 0.75, y + trunk + r * 0.15, r * 0.7);
        disc(g, x + r * 0.75, y + trunk + r * 0.15, r * 0.7);
      }
      break;
    }

    case 'conifer': {
      const w = size * 0.42;
      if (pass === 'ink') {
        g.moveTo(x, y).lineTo(x, y + size);
      } else if (pass === 'foliage') {
        for (let tier = 0; tier < 3; tier += 1) {
          const ty = y + size * (0.25 + tier * 0.24);
          const tw = w * (1 - tier * 0.24);
          g.moveTo(x - tw, ty)
            .lineTo(x, ty + size * 0.3)
            .lineTo(x + tw, ty)
            .closePath();
        }
      }
      break;
    }

    case 'dune': {
      if (pass !== 'sand') break;
      const w = size * 0.75;
      cubic(
        g,
        x - w * 0.5,
        y,
        x - w * 0.2,
        y + size * 0.45,
        x + w * 0.15,
        y + size * 0.3,
        x + w * 0.5,
        y,
      );
      break;
    }

    case 'marsh': {
      if (pass !== 'water') break;
      const w = size * 0.7;
      for (let line = 0; line < 2; line += 1) {
        const ly = y + line * size * 0.28;
        g.moveTo(x - w * 0.5, ly).lineTo(x + w * 0.5, ly);
      }
      g.moveTo(x, y + size * 0.28).lineTo(x, y + size * 0.7);
      break;
    }
  }
}

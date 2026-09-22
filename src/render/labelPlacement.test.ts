import { describe, expect, it } from 'vitest';
import {
  findLabelSpot,
  iconRect,
  labelCandidates,
  labelRect,
  overlaps,
  type Rect,
} from '@/render/labelPlacement';

describe('chevauchement', () => {
  const a: Rect = { x: 0, y: 0, w: 10, h: 10 };

  it('détecte un recouvrement partiel', () => {
    expect(overlaps(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('laisse passer deux rectangles disjoints', () => {
    expect(overlaps(a, { x: 20, y: 0, w: 10, h: 10 })).toBe(false);
    expect(overlaps(a, { x: 0, y: 20, w: 10, h: 10 })).toBe(false);
  });

  it('considère deux rectangles jointifs comme disjoints', () => {
    expect(overlaps(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('placement d un nom', () => {
  const x = 100;
  const y = 100;
  const radius = 6;
  const w = 40;
  const h = 12;

  it('propose quatre positions autour de l icône', () => {
    expect(labelCandidates(x, y, radius, w, h)).toHaveLength(4);
  });

  it('préfère la droite quand la place est libre', () => {
    const spot = findLabelSpot(x, y, radius, w, h, []);
    expect(spot?.x).toBeGreaterThan(x);
    expect(spot?.y).toBe(y);
  });

  it("n'est jamais empêché par l'icône du lieu qu'il nomme", () => {
    // Le bug d'origine : les quatre candidates frôlent cette icône, donc la
    // passer en obstacle faisait disparaître tous les noms de la carte.
    const spot = findLabelSpot(x, y, radius, w, h, []);
    expect(spot).toBeDefined();
    expect(overlaps(iconRect(x, y, radius), labelRect(spot!.x, spot!.y, w, h))).toBe(false);
  });

  it('se rabat à gauche quand la droite est prise', () => {
    const right = labelCandidates(x, y, radius, w, h)[0]!;
    const blocked = [labelRect(right.x, right.y, w, h)];
    const spot = findLabelSpot(x, y, radius, w, h, blocked);
    expect(spot?.x).toBeLessThan(x);
  });

  it('renonce quand les quatre positions sont prises', () => {
    const blocked = labelCandidates(x, y, radius, w, h).map((c) => labelRect(c.x, c.y, w, h));
    expect(findLabelSpot(x, y, radius, w, h, blocked)).toBeUndefined();
  });

  it('entoure l icône d une marge', () => {
    const rect = iconRect(x, y, radius);
    expect(rect.w).toBeGreaterThan(radius * 2);
    expect(rect.x).toBeLessThan(x - radius);
  });
});

import { describe, expect, it } from 'vitest';
import { DRY_SENTINEL, isSubmerged, waterSurfaceM } from '@/render/waterSurface';

describe('surface d eau', () => {
  it('retient le niveau de la mer sur une cellule sèche', () => {
    expect(waterSurfaceM(0, DRY_SENTINEL)).toBe(0);
  });

  it('retient le plan d eau d un lac de montagne', () => {
    expect(waterSurfaceM(0, 850)).toBe(850);
  });

  it("n'attend pas l'hydrologie pour faire monter la mer", () => {
    // Le cas qui posait problème : le niveau de la mer vient d'être relevé,
    // la couche calculée est encore celle d'avant et dit « sec ».
    expect(waterSurfaceM(900, DRY_SENTINEL)).toBe(900);
    expect(isSubmerged(400, 900, DRY_SENTINEL)).toBe(true);
  });

  it('se passe entièrement de la couche calculée', () => {
    expect(waterSurfaceM(120, undefined)).toBe(120);
    expect(isSubmerged(80, 120, undefined)).toBe(true);
    expect(isSubmerged(300, 120, undefined)).toBe(false);
  });

  it('noie ce qui est sous la surface et pas ce qui la dépasse', () => {
    expect(isSubmerged(-10, 0, DRY_SENTINEL)).toBe(true);
    expect(isSubmerged(10, 0, DRY_SENTINEL)).toBe(false);
    expect(isSubmerged(0, 0, DRY_SENTINEL)).toBe(false);
  });

  it('laisse la mer primer sur une cuvette plus basse qu elle', () => {
    // Compromis documenté : la dépression est noyée de toute façon.
    expect(waterSurfaceM(0, -200)).toBe(0);
  });
});

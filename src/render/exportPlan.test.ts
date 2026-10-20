import { describe, expect, it } from 'vitest';
import {
  MAX_EXPORT_WIDTH_PX,
  ornamentScale,
  planExport,
  scaleBar,
  terraIncognitaSpot,
} from '@/render/exportPlan';
import type { WorldRect } from '@/model/viewport';

const rect: WorldRect = { lonWestWorld: 0, latNorth: 20, widthDeg: 40, heightDeg: 20 };

describe('taille d un export', () => {
  it('déduit la hauteur du rapport d aspect du cadre', () => {
    const plan = planExport(rect, 2000, 16384);
    expect(plan).toEqual({
      ok: true,
      value: { widthPx: 2000, heightPx: 1000, pixelsPerDegree: 50, bytes: 2000 * 1000 * 4 * 3 },
    });
  });

  it('refuse au-delà de la texture du GPU, et propose une largeur qui passe', () => {
    const tall: WorldRect = { ...rect, widthDeg: 10, heightDeg: 40 };
    const plan = planExport(tall, 4000, 8192);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatch(/carte graphique/);
    expect(plan.suggestedWidthPx).toBe(2048);
    expect(planExport(tall, plan.suggestedWidthPx!, 8192).ok).toBe(true);
  });

  it('plafonne la largeur proposée au MJ', () => {
    const plan = planExport({ ...rect, heightDeg: 1 }, MAX_EXPORT_WIDTH_PX + 1, 65536);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.suggestedWidthPx).toBe(MAX_EXPORT_WIDTH_PX);
  });

  it('refuse un cadre vide', () => {
    expect(planExport({ ...rect, widthDeg: 0 }, 1000, 16384).ok).toBe(false);
  });
});

describe('agrandissement des ornements', () => {
  it('garde la taille d écran jusqu à la largeur de référence, puis agrandit', () => {
    expect(ornamentScale(1200)).toBe(1);
    expect(ornamentScale(1600)).toBe(1);
    expect(ornamentScale(6400)).toBe(4);
  });
});

describe('barre d échelle', () => {
  it('choisit une longueur ronde qui tient dans la place donnée', () => {
    // À l'équateur, sur une planète de 6371 km : 111,2 km par degré.
    const equator: WorldRect = { lonWestWorld: 0, latNorth: 10, widthDeg: 20, heightDeg: 20 };
    const bar = scaleBar(equator, 10, 6371, 200);
    // 200 px = 20° ≈ 2224 km : la longueur ronde la plus proche par défaut est 2000.
    expect(bar.km).toBe(2000);
    expect(bar.lengthPx).toBeCloseTo((2000 / 111.19) * 10, 0);
  });
});

describe('place de « Terra incognita »', () => {
  it('se met au cœur de la plus grande plage inconnue', () => {
    // Moitié gauche révélée, moitié droite inconnue.
    const spot = terraIncognitaSpot(800, 400, (x) => (x < 400 ? 1 : 0), 50)!;
    expect(spot.x).toBeGreaterThan(500);
    expect(spot.x).toBeLessThan(700);
    expect(spot.y).toBeGreaterThan(120);
    expect(spot.y).toBeLessThan(280);
  });

  it('renonce quand l inconnu est trop étroit', () => {
    expect(terraIncognitaSpot(800, 400, (x) => (x < 780 ? 1 : 0), 50)).toBeUndefined();
  });

  it('renonce quand tout est révélé', () => {
    expect(terraIncognitaSpot(800, 400, () => 1, 10)).toBeUndefined();
  });
});

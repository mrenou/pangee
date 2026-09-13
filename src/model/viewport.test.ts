import { describe, expect, it } from 'vitest';
import { DEFAULT_RING_CONFIG } from '@/model/ring';
import {
  clampCenterLat,
  clampZoom,
  minPixelsPerDegree,
  normalizeViewport,
  panByPixels,
  screenToLocal,
  screenToWorld,
  visibleSpanDeg,
  worldToScreen,
  zoomAtPoint,
  type Viewport,
} from '@/model/viewport';

const base: Viewport = {
  centerLonWorld: 0,
  centerLat: 0,
  pixelsPerDegree: 10,
  widthPx: 1920,
  heightPx: 1080,
};

describe('screenToWorld', () => {
  it('place le centre de l écran au centre de la caméra', () => {
    const g = screenToWorld(base, { x: base.widthPx / 2, y: base.heightPx / 2 });
    expect(g.lon).toBeCloseTo(0);
    expect(g.lat).toBeCloseTo(0);
  });

  it('va vers l est à droite et vers le nord en haut', () => {
    expect(
      screenToWorld(base, { x: base.widthPx / 2 + 100, y: base.heightPx / 2 }).lon,
    ).toBeCloseTo(10);
    expect(
      screenToWorld(base, { x: base.widthPx / 2, y: base.heightPx / 2 - 100 }).lat,
    ).toBeCloseTo(10);
  });

  it('wrappe la longitude au lieu de sortir du domaine', () => {
    const v: Viewport = { ...base, centerLonWorld: 175 };
    expect(screenToWorld(v, { x: base.widthPx / 2 + 100, y: base.heightPx / 2 }).lon).toBeCloseTo(
      -175,
    );
  });
});

describe('worldToScreen', () => {
  it('est l inverse de screenToWorld', () => {
    const v: Viewport = { ...base, centerLonWorld: 42, centerLat: 17 };
    for (const p of [
      { x: 0, y: 0 },
      { x: 960, y: 540 },
      { x: 1900, y: 1000 },
    ]) {
      const round = worldToScreen(v, screenToWorld(v, p));
      expect(round.x).toBeCloseTo(p.x, 6);
      expect(round.y).toBeCloseTo(p.y, 6);
    }
  });

  it('sort du bon côté de l écran de l autre côté du méridien ±180', () => {
    // Caméra à 175°E, point à 175°W : il est 10° à l'est, donc à droite.
    const v: Viewport = { ...base, centerLonWorld: 175 };
    const p = worldToScreen(v, { lon: -175, lat: 0 });
    expect(p.x).toBeGreaterThan(v.widthPx / 2);
    expect(p.x).toBeCloseTo(v.widthPx / 2 + 100);
  });
});

describe('bornes de la caméra', () => {
  it('empêche de dézoomer au-delà de la planète entière', () => {
    expect(minPixelsPerDegree(1080)).toBeCloseTo(6);
    expect(clampZoom(0.5, 1080)).toBeCloseTo(6);
    expect(clampZoom(1e6, 1080)).toBe(400);
  });

  it('empêche les pôles d entrer dans l écran', () => {
    // Demi-hauteur de 54°, donc le centre ne peut pas dépasser 36°.
    expect(clampCenterLat(80, 1080, 10)).toBeCloseTo(36);
    expect(clampCenterLat(-80, 1080, 10)).toBeCloseTo(-36);
    expect(clampCenterLat(10, 1080, 10)).toBe(10);
  });

  it('recentre sur l équateur quand la planète entière tient à l écran', () => {
    expect(clampCenterLat(40, 1080, minPixelsPerDegree(1080))).toBe(0);
  });

  it('applique les deux bornes ensemble', () => {
    const v = normalizeViewport({
      ...base,
      centerLonWorld: 200,
      centerLat: 89,
      pixelsPerDegree: 0,
    });
    expect(v.centerLonWorld).toBeCloseTo(-160);
    expect(v.pixelsPerDegree).toBeCloseTo(6);
    expect(v.centerLat).toBe(0);
  });
});

describe('pan', () => {
  it('suit le doigt : tirer vers la droite fait défiler vers l ouest', () => {
    const v = panByPixels(base, 100, 0);
    expect(v.centerLonWorld).toBeCloseTo(-10);
  });

  it('fait le tour du monde sans butée', () => {
    let v: Viewport = base;
    for (let i = 0; i < 36; i += 1) v = panByPixels(v, -100, 0);
    expect(v.centerLonWorld).toBeCloseTo(0);
  });

  it('bute en latitude au lieu de wrapper', () => {
    let v: Viewport = base;
    for (let i = 0; i < 100; i += 1) v = panByPixels(v, 0, 100);
    expect(v.centerLat).toBeCloseTo(36);
  });
});

describe('zoom', () => {
  it('garde le point visé sous le curseur', () => {
    const anchor = { x: 1500, y: 300 };
    const before = screenToWorld(base, anchor);
    const after = screenToWorld(zoomAtPoint(base, 2, anchor), anchor);
    expect(after.lon).toBeCloseTo(before.lon, 6);
    expect(after.lat).toBeCloseTo(before.lat, 6);
  });

  it('garde le centre immobile quand on zoome au centre', () => {
    const v = zoomAtPoint(base, 1.5, { x: base.widthPx / 2, y: base.heightPx / 2 });
    expect(v.centerLonWorld).toBeCloseTo(0);
    expect(v.centerLat).toBeCloseTo(0);
    expect(v.pixelsPerDegree).toBeCloseTo(15);
  });

  it('réduit l étendue visible quand on zoome', () => {
    const before = visibleSpanDeg(base);
    const after = visibleSpanDeg(zoomAtPoint(base, 2, { x: 960, y: 540 }));
    expect(after.lonSpan).toBeCloseTo(before.lonSpan / 2);
    expect(after.latSpan).toBeCloseTo(before.latSpan / 2);
  });
});

describe('screenToLocal', () => {
  const cfg = DEFAULT_RING_CONFIG;

  it('ne change rien à t0', () => {
    const p = { x: 1500, y: 300 };
    expect(screenToLocal(base, p, cfg, cfg.t0).lon).toBeCloseTo(screenToWorld(base, p).lon);
  });

  it('retire le décalage de l anneau visé à une autre date', () => {
    // Un point au nord de la coupure : l'anneau nord a tourné, l'outil doit
    // écrire à la longitude locale, pas à celle affichée.
    const v: Viewport = { ...base, centerLat: 50, pixelsPerDegree: 4 };
    const p = { x: v.widthPx / 2, y: v.heightPx / 2 };
    const tDays = 100;
    const world = screenToWorld(v, p);
    const local = screenToLocal(v, p, cfg, tDays);
    const offset = cfg.rings.north.omegaDegPerDay * (tDays - cfg.t0);
    expect(world.lat).toBeGreaterThan(cfg.cutNorthLat);
    expect(local.lon).toBeCloseTo(world.lon - offset);
  });
});

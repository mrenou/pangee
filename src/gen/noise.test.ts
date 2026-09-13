import { describe, expect, it } from 'vitest';
import { createNoise3D } from 'simplex-noise';
import { fbmCylinder, sampleCylinder, smoothstep } from '@/gen/noise';
import { rngFor } from '@/gen/rng';

const noise3D = createNoise3D(rngFor('test', 'relief'));

describe('sampleCylinder', () => {
  it('est continu au méridien ±180 : c est tout l intérêt du cylindre', () => {
    // Le bruit 2D naïf ferait un saut ici. En 3D sur un cercle, -180 et +180
    // sont le même point de l'espace de bruit — à l'arrondi près : cos(±π) vaut
    // exactement -1, donc le point tombe pile sur une frontière de grille du
    // simplex, là où l'erreur flottante est maximale. On tolère 1e-3, contre
    // une discontinuité de l'ordre de l'unité qu'aurait donnée un bruit 2D.
    for (const lat of [-60, 0, 45]) {
      expect(sampleCylinder(noise3D, 180, lat, 2)).toBeCloseTo(
        sampleCylinder(noise3D, -180, lat, 2),
        3,
      );
    }
  });

  it('varie continûment de part et d autre de la couture', () => {
    const before = sampleCylinder(noise3D, 179.9, 20, 2);
    const at = sampleCylinder(noise3D, 180, 20, 2);
    const after = sampleCylinder(noise3D, -179.9, 20, 2);
    expect(Math.abs(at - before)).toBeLessThan(0.05);
    expect(Math.abs(after - at)).toBeLessThan(0.05);
  });

  it('fait le tour complet sans dérive', () => {
    expect(sampleCylinder(noise3D, 30, 10, 3)).toBeCloseTo(sampleCylinder(noise3D, 390, 10, 3), 10);
  });
});

describe('fbmCylinder', () => {
  const params = { octaves: 5, frequency: 1.5, lacunarity: 2, persistence: 0.5 };

  it('reste normalisé dans [-1, 1]', () => {
    for (let i = 0; i < 500; i += 1) {
      const lon = -180 + (360 * i) / 500;
      const v = fbmCylinder(noise3D, lon, ((i % 90) - 45) * 2, params);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('est continu au wrap', () => {
    expect(fbmCylinder(noise3D, 180, 33, params)).toBeCloseTo(
      fbmCylinder(noise3D, -180, 33, params),
      3,
    );
  });

  it('renvoie 0 sans octave', () => {
    expect(fbmCylinder(noise3D, 12, 34, { ...params, octaves: 0 })).toBe(0);
  });
});

describe('smoothstep', () => {
  it('vaut 0 avant, 1 après, et 0,5 au milieu', () => {
    expect(smoothstep(70, 88, 60)).toBe(0);
    expect(smoothstep(70, 88, 90)).toBe(1);
    expect(smoothstep(70, 88, 79)).toBeCloseTo(0.5);
  });

  it('ne divise pas par zéro quand les bornes sont confondues', () => {
    expect(smoothstep(5, 5, 4)).toBe(0);
    expect(smoothstep(5, 5, 6)).toBe(1);
  });
});

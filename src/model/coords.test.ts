import { describe, expect, it } from 'vitest';
import {
  clampLat,
  columnOfLon,
  deltaLon,
  idx,
  latOfRow,
  lonOfColumn,
  rowOfLat,
  wrapLon,
  wrapX,
} from '@/model/coords';

describe('wrapLon', () => {
  it('laisse les longitudes déjà dans le domaine', () => {
    expect(wrapLon(0)).toBe(0);
    expect(wrapLon(-179)).toBe(-179);
    expect(wrapLon(179)).toBe(179);
  });

  it('ramène le domaine sur [-180, 180[ : +180 devient -180', () => {
    expect(wrapLon(180)).toBe(-180);
    expect(wrapLon(-180)).toBe(-180);
  });

  it('gère plusieurs tours dans les deux sens', () => {
    expect(wrapLon(360)).toBe(0);
    expect(wrapLon(-360)).toBe(0);
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(720 + 45)).toBe(45);
  });
});

describe('clampLat', () => {
  it('borne les pôles au lieu de wrapper', () => {
    expect(clampLat(95)).toBe(90);
    expect(clampLat(-95)).toBe(-90);
    expect(clampLat(12.5)).toBe(12.5);
  });
});

describe('deltaLon', () => {
  it('prend le chemin le plus court, y compris par le méridien de wrap', () => {
    expect(deltaLon(170, -170)).toBe(20);
    expect(deltaLon(-170, 170)).toBe(-20);
    expect(deltaLon(0, 90)).toBe(90);
  });
});

describe('indexation des rasters', () => {
  it('indexe ligne par ligne', () => {
    expect(idx(3, 2, 10)).toBe(23);
  });

  it('wrappe en x et jamais en y', () => {
    expect(wrapX(-1, 8)).toBe(7);
    expect(wrapX(8, 8)).toBe(0);
    expect(wrapX(17, 8)).toBe(1);
  });
});

describe('cellules et coordonnées', () => {
  const width = 8;
  const height = 4;

  it('place la première colonne juste après -180 et la dernière juste avant +180', () => {
    expect(lonOfColumn(0, width)).toBeCloseTo(-157.5);
    expect(lonOfColumn(width - 1, width)).toBeCloseTo(157.5);
  });

  it('place la première ligne au nord', () => {
    expect(latOfRow(0, height)).toBeCloseTo(67.5);
    expect(latOfRow(height - 1, height)).toBeCloseTo(-67.5);
  });

  it('fait l aller-retour cellule → coordonnée → cellule', () => {
    for (let x = 0; x < width; x += 1) {
      expect(columnOfLon(lonOfColumn(x, width), width)).toBe(x);
    }
    for (let y = 0; y < height; y += 1) {
      expect(rowOfLat(latOfRow(y, height), height)).toBe(y);
    }
  });

  it('retrouve la bonne colonne de part et d autre du méridien ±180', () => {
    expect(columnOfLon(-180, width)).toBe(0);
    expect(columnOfLon(180, width)).toBe(0);
    expect(columnOfLon(-181, width)).toBe(width - 1);
  });
});

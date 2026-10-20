import { describe, expect, it } from 'vitest';
import { creaturePose, pathLengthDeg } from '@/render/creatureMotion';

// Un carré de 10° de côté, parcouru dans le sens trigonométrique :
//   (0,10) ← (10,10)
//     ↓         ↑
//   (0, 0) → (10, 0)
const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
] as const;

describe('trajectoire d une créature', () => {
  it('mesure une boucle avec son segment de fermeture', () => {
    expect(pathLengthDeg(square, true)).toBeCloseTo(40);
    expect(pathLengthDeg(square, false)).toBeCloseTo(30);
  });

  it('avance le long des segments, cap compris', () => {
    const pose = creaturePose(square, true, 15);
    expect(pose.lonLocal).toBeCloseTo(10);
    expect(pose.lat).toBeCloseTo(5);
    expect(pose.headingDeg).toBeCloseTo(90);
  });

  it('recommence une boucle au début', () => {
    const pose = creaturePose(square, true, 45);
    expect(pose.lonLocal).toBeCloseTo(5);
    expect(pose.lat).toBeCloseTo(0);
  });

  it('fait demi-tour au bout d un aller-retour', () => {
    // 30° pour aller, 5° de retour : on redescend le deuxième segment.
    const pose = creaturePose(square, false, 35);
    expect(pose.lonLocal).toBeCloseTo(5);
    expect(pose.lat).toBeCloseTo(10);
    expect(pose.headingDeg).toBeCloseTo(0);
  });

  it('passe la couture du méridien ±180', () => {
    const pose = creaturePose(
      [
        [175, 0],
        [-175, 0],
      ],
      false,
      5,
    );
    expect(Math.abs(pose.lonLocal)).toBeCloseTo(180);
  });
});

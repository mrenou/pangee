/**
 * Placement des libellés, sans Pixi.
 *
 * Cette logique vivait dans la couche de rendu, où un bug est passé inaperçu :
 * le libellé était testé contre le rectangle de sa propre icône, qu'il frôlait
 * par construction, si bien qu'aucun nom ne s'affichait jamais. Isolée ici, elle
 * est vérifiable — et l'écart à l'icône est maintenant assez grand pour qu'une
 * position candidate ne la touche jamais, ce qui supprime le piège plutôt que
 * de l'éviter. Voir docs/rendu.md.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Marge autour d'un libellé, pour que deux noms ne se frôlent pas. */
export const PADDING_PX = 3;

export function iconRect(x: number, y: number, radius: number): Rect {
  return {
    x: x - radius - PADDING_PX,
    y: y - radius - PADDING_PX,
    w: (radius + PADDING_PX) * 2,
    h: (radius + PADDING_PX) * 2,
  };
}

/** Rectangle d'un libellé dont l'ancre est à gauche, centrée verticalement. */
export function labelRect(x: number, y: number, w: number, h: number): Rect {
  return {
    x: x - PADDING_PX,
    y: y - h / 2 - PADDING_PX,
    w: w + PADDING_PX * 2,
    h: h + PADDING_PX * 2,
  };
}

/**
 * Les quatre positions possibles d'un nom autour de son icône, dans l'ordre de
 * préférence typographique : à droite, à gauche, au-dessus, au-dessous.
 */
export function labelCandidates(
  x: number,
  y: number,
  radius: number,
  w: number,
  h: number,
): readonly { readonly x: number; readonly y: number }[] {
  // Deux marges, plus un pixel : de quoi garantir qu'aucune position ne touche
  // l'icône qu'elle accompagne, quelle que soit la taille du lieu.
  const gap = radius + PADDING_PX * 2 + 1;
  return [
    { x: x + gap, y },
    { x: x - gap - w, y },
    { x: x - w / 2, y: y - gap - h / 2 },
    { x: x - w / 2, y: y + gap + h / 2 },
  ];
}

/**
 * Première position libre pour un nom, ou `undefined` s'il doit être omis.
 *
 * `occupied` peut contenir l'icône de ce lieu-ci : l'écart garantit qu'aucune
 * position ne la recouvre.
 */
export function findLabelSpot(
  x: number,
  y: number,
  radius: number,
  w: number,
  h: number,
  occupied: readonly Rect[],
): { readonly x: number; readonly y: number } | undefined {
  return labelCandidates(x, y, radius, w, h).find(
    (candidate) =>
      !occupied.some((rect) => overlaps(rect, labelRect(candidate.x, candidate.y, w, h))),
  );
}

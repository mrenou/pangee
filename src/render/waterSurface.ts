/**
 * Quelle eau recouvre une cellule.
 *
 * Cette règle est appliquée à deux endroits — le shader de terrain et le semis
 * des symboles — et doit y être identique, sans quoi des arbres flottent sur la
 * mer. Elle vit donc ici, en clair et testée, et le GLSL la recopie.
 * Voir docs/rendu.md.
 */

/** Valeur portée par une cellule sèche dans la couche `waterLevel`. */
export const DRY_SENTINEL = -1e9;

/**
 * Altitude de la surface d'eau.
 *
 * C'est la plus haute du niveau de la mer, connu immédiatement, et du plan
 * d'eau calculé par l'hydrologie, qui arrive après coup et n'apporte que les
 * lacs et les mers intérieures. S'en remettre au seul plan d'eau ferait
 * attendre un recalcul pour voir la mer monter.
 *
 * Contrepartie assumée : une cuvette fermée dont le plan d'eau est plus bas que
 * la mer est rendue au niveau de la mer. Elle est noyée de toute façon.
 */
export function waterSurfaceM(seaLevelM: number, waterLevelM: number | undefined): number {
  if (waterLevelM === undefined) return seaLevelM;
  return Math.max(seaLevelM, waterLevelM);
}

/** La cellule est-elle sous l'eau ? */
export function isSubmerged(
  heightM: number,
  seaLevelM: number,
  waterLevelM: number | undefined,
): boolean {
  return waterSurfaceM(seaLevelM, waterLevelM) > heightM;
}

/**
 * Rattrapage du retard des couches dérivées.
 *
 * Les couches assemblées en référentiel monde — relief assemblé, eau, biomes,
 * réseau hydrographique — sont calculées pour une date, et n'arrivent qu'après
 * que le curseur a bougé. Les afficher telles quelles les laisse en arrière du
 * continent : les rivières quittent leurs vallées, les montagnes se posent sur
 * un relief périmé.
 *
 * Décaler leur lecture de ce que l'anneau a parcouru depuis remet chaque chose
 * en place — exactement, et non approximativement : le monde local, lui, n'a
 * pas bougé. Le calcul suivant ne corrige alors que la forme de l'eau.
 *
 * La même règle vaut dans le shader de terrain, qui la recopie en GLSL.
 * Voir docs/rendu.md.
 */

import { ringIndexOf, type RingConfig } from '@/model/ring';
import { ringOffsetDeg } from '@/model/time';

/**
 * Degrés dont une couche datée de `layerTDays` a pris du retard à cette
 * latitude, la date courante étant `tDays`.
 *
 * Retrancher cette valeur d'une longitude monde donne la longitude à laquelle
 * lire la couche ; l'ajouter à un point de la couche le remet là où il devrait
 * être affiché.
 */
export function worldLagDeg(
  cfg: RingConfig,
  lat: number,
  tDays: number,
  layerTDays: number,
): number {
  const ring = cfg.rings[ringIndexOf(lat, cfg)]!;
  return ringOffsetDeg(ring, tDays, cfg.t0) - ringOffsetDeg(ring, layerTDays, cfg.t0);
}

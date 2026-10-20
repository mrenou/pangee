/**
 * Réaffectation des objets du monde quand les anneaux changent.
 *
 * Toutes les données sont en référentiel local, celui d'avant le Cataclysme :
 * scinder un anneau, fusionner deux anneaux ou déplacer une coupure ne touche
 * à aucune coordonnée. Seul l'anneau porté par chaque objet change — et une
 * route qui franchit désormais une coupure doit être scindée, comme à sa
 * création. Voir docs/editeur.md.
 */

import { buildRoads } from '@/edit/roads';
import { ringOf, type RingConfig } from '@/model/ring';
import type { Creature, Place, Road } from '@/model/world';

export interface RingBoundObjects {
  readonly places: readonly Place[];
  readonly roads: readonly Road[];
  readonly creatures: readonly Creature[];
}

/** Une route garde son identifiant tant qu'elle n'est pas coupée. */
function reassignRoad(road: Road, cfg: RingConfig): readonly Road[] {
  const pieces = buildRoads(road.points, cfg, road.kind, road.id);
  if (pieces.length === 1) return [{ ...road, ringId: pieces[0]!.ringId }];
  return pieces;
}

/**
 * Recalcule l'anneau de chaque lieu, de chaque route et de chaque créature
 * pour une nouvelle configuration. Une créature garde son anneau s'il existe
 * encore ; sinon elle rejoint celui de son premier point.
 */
export function reassignToRings(objects: RingBoundObjects, cfg: RingConfig): RingBoundObjects {
  const ids = new Set(cfg.rings.map((ring) => ring.id));
  return {
    places: objects.places.map((place) => {
      const ringId = ringOf(place.lat, cfg);
      return ringId === place.ringId ? place : { ...place, ringId };
    }),
    roads: objects.roads.flatMap((road) => reassignRoad(road, cfg)),
    creatures: objects.creatures.map((creature) =>
      ids.has(creature.ringId)
        ? creature
        : { ...creature, ringId: ringOf(creature.points[0]?.[1] ?? 0, cfg) },
    ),
  };
}

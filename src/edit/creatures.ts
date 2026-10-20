/**
 * Édition des créatures décoratives : création, sélection, retouche.
 *
 * Une trajectoire est exprimée dans le référentiel local d'un seul anneau,
 * celui du premier point posé : elle tourne avec lui. Voir docs/editeur.md.
 */

import { distanceToSegment, type Point } from '@/edit/roads';
import { deltaLon, wrapLon } from '@/model/coords';
import { ringOf, type RingConfig, type RingId } from '@/model/ring';
import { offsetOfRing } from '@/model/time';
import type { Creature, CreatureKind } from '@/model/world';

export const CREATURE_NAMES: Readonly<Record<CreatureKind, string>> = {
  dragon: 'Dragon',
  ship: 'Navire',
  bird: 'Oiseaux',
  serpent: 'Serpent de mer',
};

/** Vitesse d'une créature neuve, en degrés par seconde d'animation. */
export const DEFAULT_CREATURE_SPEED_DEG_PER_S = 2;

export type CreatureEdit = Partial<Pick<Creature, 'name' | 'kind' | 'speedDegPerS' | 'loop'>>;

/** Anneau d'une trajectoire : celui de son premier point, en référentiel monde. */
export function creatureRing(firstLat: number, cfg: RingConfig): RingId {
  return ringOf(firstLat, cfg);
}

/** Point monde vers le référentiel local d'un anneau donné, à la date donnée. */
export function worldToRingLocal(
  lonWorld: number,
  ringId: RingId,
  cfg: RingConfig,
  tDays: number,
): number {
  return wrapLon(lonWorld - offsetOfRing(ringId, 0, cfg, tDays));
}

export function buildCreature(
  id: string,
  kind: CreatureKind,
  ringId: RingId,
  points: readonly Point[],
): Creature | undefined {
  if (points.length < 2) return undefined;
  return {
    id,
    name: CREATURE_NAMES[kind],
    kind,
    ringId,
    points,
    speedDegPerS: DEFAULT_CREATURE_SPEED_DEG_PER_S,
    loop: true,
  };
}

/** Créature dont la trajectoire passe sous le curseur, en référentiel monde. */
export function creatureAtWorld(
  lonWorld: number,
  lat: number,
  creatures: readonly Creature[],
  cfg: RingConfig,
  tDays: number,
  maxDeg: number,
): Creature | undefined {
  let best: Creature | undefined;
  let bestDistance = maxDeg;

  for (const creature of creatures) {
    const offset = offsetOfRing(creature.ringId, creature.points[0]?.[1] ?? 0, cfg, tDays);
    const relative = creature.points.map(
      ([lon, pointLat]) => [deltaLon(lonWorld, lon + offset), pointLat - lat] as const,
    );
    const count = creature.loop ? relative.length : relative.length - 1;
    for (let i = 0; i < count; i += 1) {
      const d = distanceToSegment(relative[i]!, relative[(i + 1) % relative.length]!);
      if (d <= bestDistance) {
        bestDistance = d;
        best = creature;
      }
    }
  }

  return best;
}

export function updateCreature(
  creatures: readonly Creature[],
  id: string,
  edit: CreatureEdit,
): readonly Creature[] {
  return creatures.map((creature) => (creature.id === id ? { ...creature, ...edit } : creature));
}

export function removeCreature(creatures: readonly Creature[], id: string): readonly Creature[] {
  return creatures.filter((creature) => creature.id !== id);
}

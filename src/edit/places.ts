/**
 * Édition des lieux : sélection, déplacement, retouche des champs, suppression.
 *
 * Chaque fonction rend une nouvelle liste : c'est l'échange des deux listes,
 * avant et après, qui fait la commande annulable. Voir docs/editeur.md.
 */

import { deltaLon, wrapLon } from '@/model/coords';
import { ringOf, type RingConfig } from '@/model/ring';
import { localToWorldLon } from '@/model/time';
import type { Place, PlaceKind, PlaceSize } from '@/model/world';

/** Ce que le MJ peut retoucher d'un lieu depuis l'inspecteur. */
export interface PlaceEdit {
  readonly name?: string;
  readonly kind?: PlaceKind;
  readonly size?: PlaceSize;
  /** Une chaîne vide efface les notes. */
  readonly notes?: string;
}

/**
 * Lieu le plus proche d'un point du référentiel monde, dans la limite donnée.
 *
 * La comparaison se fait en référentiel monde, là où le MJ voit les lieux : de
 * part et d'autre d'une coupure, deux longitudes locales n'ont rien de commun
 * dès que les anneaux ont tourné.
 */
export function placeAtWorld(
  lonWorld: number,
  lat: number,
  places: readonly Place[],
  cfg: RingConfig,
  tDays: number,
  maxDeg: number,
): Place | undefined {
  let best: Place | undefined;
  let bestDistance = maxDeg;

  for (const place of places) {
    const placeLonWorld = localToWorldLon(place.lon, place.lat, cfg, tDays);
    const d = Math.hypot(deltaLon(lonWorld, placeLonWorld), place.lat - lat);
    if (d <= bestDistance) {
      bestDistance = d;
      best = place;
    }
  }

  return best;
}

/**
 * Déplace un lieu en un point local. Son anneau est recalculé depuis la
 * latitude : le MJ ne le choisit jamais.
 */
export function movePlace(
  places: readonly Place[],
  id: string,
  lonLocal: number,
  lat: number,
  cfg: RingConfig,
): readonly Place[] {
  return places.map((place) =>
    place.id === id ? { ...place, lon: wrapLon(lonLocal), lat, ringId: ringOf(lat, cfg) } : place,
  );
}

export function updatePlace(
  places: readonly Place[],
  id: string,
  edit: PlaceEdit,
): readonly Place[] {
  return places.map((place) => {
    if (place.id !== id) return place;

    const { notes, ...rest } = edit;
    const next: Place = { ...place, ...rest };
    if (notes === undefined) return next;

    // Avec exactOptionalPropertyTypes, des notes absentes s'écrivent par
    // l'absence du champ, pas par une chaîne vide.
    const { notes: _previous, ...withoutNotes } = next;
    const trimmed = notes.trim();
    return trimmed === '' ? withoutNotes : { ...withoutNotes, notes };
  });
}

export function removePlace(places: readonly Place[], id: string): readonly Place[] {
  return places.filter((place) => place.id !== id);
}

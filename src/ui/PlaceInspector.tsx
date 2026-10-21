import { useState } from 'react';
import type { Place, PlaceKind, PlaceSize } from '@/model/world';
import { useEditStore } from '@/store/editStore';
import { useWorldStore } from '@/store/worldStore';

const KINDS: readonly { readonly id: PlaceKind; readonly label: string }[] = [
  { id: 'city', label: 'Cité' },
  { id: 'town', label: 'Bourg' },
  { id: 'village', label: 'Village' },
  { id: 'fortress', label: 'Forteresse' },
  { id: 'ruin', label: 'Ruine' },
  { id: 'volcano', label: 'Volcan' },
  { id: 'landmark', label: 'Lieu-dit' },
];

const SIZES: readonly { readonly id: PlaceSize; readonly label: string }[] = [
  { id: 1, label: 'Mineur' },
  { id: 2, label: 'Notable' },
  { id: 3, label: 'Important' },
  { id: 4, label: 'Majeur' },
];

const FIELD_CLASS =
  'mt-1 w-full rounded border border-ink-soft/40 bg-parchment-dark px-2 py-1 text-sm';

/**
 * Fiche du lieu sélectionné sur la carte. Voir docs/editeur.md.
 *
 * Le nom et les notes ne sont validés qu'à la sortie du champ : une commande
 * par frappe noierait la pile d'annulation.
 */
export function PlaceInspector() {
  const selectedId = useEditStore((s) => s.selectedPlaceId);
  const place = useWorldStore((s) => s.places.find((p) => p.id === selectedId));

  if (!place) {
    return (
      <p className="mt-2 text-xs text-ink-soft">
        Cliquer sur un lieu pour l’ouvrir, le glisser pour le déplacer.
      </p>
    );
  }

  // La clé remet les brouillons à zéro quand on passe d'un lieu à l'autre.
  return <PlaceForm key={place.id} place={place} />;
}

function PlaceForm({ place }: { readonly place: Place }) {
  const editPlace = useEditStore((s) => s.editPlace);
  const deletePlace = useEditStore((s) => s.deleteSelectedPlace);
  // Les anneaux sont ceux du monde, nommés par le MJ, et non plus trois anneaux fixes.
  const ringName = useWorldStore(
    (s) => s.ringConfig.rings.find((ring) => ring.id === place.ringId)?.name,
  );
  const [name, setName] = useState(place.name);
  const [notes, setNotes] = useState(place.notes ?? '');

  const commitName = (): void => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setName(place.name);
      return;
    }
    if (trimmed !== place.name) editPlace({ name: trimmed }, 'lieu renommé');
  };

  const commitNotes = (): void => {
    if (notes !== (place.notes ?? '')) editPlace({ notes }, 'notes du lieu');
  };

  return (
    <div className="mt-3 rounded border border-ink-soft/30 p-2">
      <label className="block text-sm" htmlFor="place-name">
        Nom
      </label>
      <input
        id="place-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setName(place.name);
        }}
        className={FIELD_CLASS}
      />

      <div className="mt-2 flex gap-2">
        <div className="flex-1">
          <label className="block text-sm" htmlFor="place-kind">
            Type
          </label>
          <select
            id="place-kind"
            value={place.kind}
            onChange={(e) =>
              editPlace({ kind: e.currentTarget.value as PlaceKind }, 'type du lieu')
            }
            className={FIELD_CLASS}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-sm" htmlFor="place-size">
            Importance
          </label>
          <select
            id="place-size"
            value={place.size}
            onChange={(e) =>
              editPlace({ size: Number(e.currentTarget.value) as PlaceSize }, 'importance du lieu')
            }
            className={FIELD_CLASS}
          >
            {SIZES.map((size) => (
              <option key={size.id} value={size.id}>
                {size.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="mt-2 block text-sm" htmlFor="place-notes">
        Notes du MJ
      </label>
      <textarea
        id="place-notes"
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        onBlur={commitNotes}
        className={FIELD_CLASS}
      />

      <p className="mt-1 text-xs text-ink-soft">
        {ringName ?? 'Anneau inconnu'} · {place.lat.toFixed(1)}° de latitude
      </p>

      <button
        type="button"
        onClick={deletePlace}
        className="mt-2 w-full rounded border border-red-800/40 px-2 py-1 text-xs text-red-800 hover:bg-parchment-dark"
      >
        Supprimer le lieu (Suppr)
      </button>
    </div>
  );
}

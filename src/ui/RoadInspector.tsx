import type { Road, RoadKind } from '@/model/world';
import { useEditStore } from '@/store/editStore';
import { useWorldStore } from '@/store/worldStore';

const KINDS: readonly { readonly id: RoadKind; readonly label: string }[] = [
  { id: 'road', label: 'Route' },
  { id: 'path', label: 'Sentier' },
  { id: 'sea-route', label: 'Route maritime' },
];

const RING_LABELS: Readonly<Record<Road['ringId'], string>> = {
  north: 'nord',
  equator: 'équatorial',
  south: 'sud',
};

const FIELD_CLASS =
  'mt-1 w-full rounded border border-ink-soft/40 bg-parchment-dark px-2 py-1 text-sm';

/** Réglages de l'outil route et fiche de la route sélectionnée. Voir docs/editeur.md. */
export function RoadInspector() {
  const followsTerrain = useEditStore((s) => s.roadFollowsTerrain);
  const setFollowsTerrain = useEditStore((s) => s.setRoadFollowsTerrain);
  const newKind = useEditStore((s) => s.newRoadKind);
  const setNewKind = useEditStore((s) => s.setNewRoadKind);
  const selectedId = useEditStore((s) => s.selectedRoadId);
  const setKind = useEditStore((s) => s.setSelectedRoadKind);
  const deleteSelection = useEditStore((s) => s.deleteSelection);
  const road = useWorldStore((s) => s.roads.find((r) => r.id === selectedId));

  return (
    <div className="mt-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={followsTerrain}
          onChange={(e) => setFollowsTerrain(e.currentTarget.checked)}
        />
        Suivre le relief
      </label>

      <label className="mt-2 block text-sm" htmlFor="new-road-kind">
        Type des nouveaux tracés
      </label>
      <select
        id="new-road-kind"
        value={newKind}
        onChange={(e) => setNewKind(e.currentTarget.value as RoadKind)}
        className={FIELD_CLASS}
      >
        {KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>

      {road ? (
        <div className="mt-3 rounded border border-ink-soft/30 p-2">
          <label className="block text-sm" htmlFor="road-kind">
            Type de la route sélectionnée
          </label>
          <select
            id="road-kind"
            value={road.kind}
            onChange={(e) => setKind(e.currentTarget.value as RoadKind)}
            className={FIELD_CLASS}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-soft">
            Anneau {RING_LABELS[road.ringId]} · {road.points.length} points. Une route coupée par
            une faille forme deux tronçons distincts.
          </p>
          <button
            type="button"
            onClick={deleteSelection}
            className="mt-2 w-full rounded border border-red-800/40 px-2 py-1 text-xs text-red-800 hover:bg-parchment-dark"
          >
            Supprimer la route (Suppr)
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-soft">
          Cliquer sur une route pour l’ouvrir ; Maj + clic pour commencer un tracé dessus.
        </p>
      )}
    </div>
  );
}

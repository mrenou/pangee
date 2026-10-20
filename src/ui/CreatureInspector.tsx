import { useState } from 'react';
import type { Creature, CreatureKind } from '@/model/world';
import { useEditStore } from '@/store/editStore';
import { useWorldStore } from '@/store/worldStore';
import { Field } from '@/ui/Field';

const KINDS: readonly { readonly id: CreatureKind; readonly label: string }[] = [
  { id: 'dragon', label: 'Dragon' },
  { id: 'ship', label: 'Navire' },
  { id: 'bird', label: 'Oiseaux' },
  { id: 'serpent', label: 'Serpent de mer' },
];

const FIELD_CLASS =
  'mt-1 w-full rounded border border-ink-soft/40 bg-parchment-dark px-2 py-1 text-sm';

/** Créatures décoratives : type des nouvelles, fiche de la sélectionnée. Voir docs/editeur.md. */
export function CreatureInspector() {
  const newKind = useEditStore((s) => s.newCreatureKind);
  const setNewKind = useEditStore((s) => s.setNewCreatureKind);
  const selectedId = useEditStore((s) => s.selectedCreatureId);
  const creature = useWorldStore((s) => s.creatures.find((c) => c.id === selectedId));
  const animate = useWorldStore((s) => s.animate);

  return (
    <div className="mt-3">
      <label className="block text-sm" htmlFor="new-creature-kind">
        Type des nouvelles créatures
      </label>
      <select
        id="new-creature-kind"
        value={newKind}
        onChange={(e) => setNewKind(e.currentTarget.value as CreatureKind)}
        className={FIELD_CLASS}
      >
        {KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      {!animate && (
        <p className="mt-1 text-xs text-ink-soft">
          Les animations sont coupées : les créatures attendent à leur premier point.
        </p>
      )}

      {creature ? (
        <CreatureForm key={creature.id} creature={creature} />
      ) : (
        <p className="mt-2 text-xs text-ink-soft">
          Cliquer pour poser les points de passage, double-clic ou Échap pour finir. Cliquer sur une
          trajectoire pour l’ouvrir ; Maj + clic pour en commencer une par-dessus.
        </p>
      )}
    </div>
  );
}

function CreatureForm({ creature }: { readonly creature: Creature }) {
  const edit = useEditStore((s) => s.editCreature);
  const deleteSelection = useEditStore((s) => s.deleteSelection);
  const [name, setName] = useState(creature.name);

  const commitName = (): void => {
    const trimmed = name.trim();
    if (trimmed === '') setName(creature.name);
    else if (trimmed !== creature.name) edit({ name: trimmed }, 'créature renommée');
  };

  return (
    <div className="mt-3 rounded border border-ink-soft/30 p-2">
      <label className="block text-sm" htmlFor="creature-name">
        Nom
      </label>
      <input
        id="creature-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className={FIELD_CLASS}
      />

      <label className="mt-2 block text-sm" htmlFor="creature-kind">
        Type
      </label>
      <select
        id="creature-kind"
        value={creature.kind}
        onChange={(e) => edit({ kind: e.currentTarget.value as CreatureKind }, 'type de créature')}
        className={FIELD_CLASS}
      >
        {KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>

      <Field
        id="creature-speed"
        label="Vitesse"
        value={`${creature.speedDegPerS.toFixed(1)} °/s`}
        min={0.2}
        max={10}
        step={0.2}
        current={creature.speedDegPerS}
        onChange={(speedDegPerS) => edit({ speedDegPerS }, 'vitesse de créature')}
      />

      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={creature.loop}
          onChange={(e) =>
            edit(
              { loop: e.currentTarget.checked },
              e.currentTarget.checked ? 'boucle' : 'aller-retour',
            )
          }
        />
        Boucler (sinon aller-retour)
      </label>

      <button
        type="button"
        onClick={deleteSelection}
        className="mt-2 w-full rounded border border-red-800/40 px-2 py-1 text-xs text-red-800 hover:bg-parchment-dark"
      >
        Retirer la créature (Suppr)
      </button>
    </div>
  );
}

import { useWorldStore } from '@/store/worldStore';
import { Field } from '@/ui/Field';

/** Réglages de la génération procédurale. Voir docs/generation.md. */
export function GenerationPanel() {
  const terrain = useWorldStore((s) => s.terrain);
  const status = useWorldStore((s) => s.status);
  const error = useWorldStore((s) => s.error);
  const setTerrain = useWorldStore((s) => s.setTerrain);
  const regenerate = useWorldStore((s) => s.regenerate);

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Le monde</h2>

      <label className="mt-3 block text-sm" htmlFor="seed">
        Graine
      </label>
      <input
        id="seed"
        type="text"
        value={terrain.seed}
        onChange={(e) => setTerrain({ seed: e.currentTarget.value })}
        className="mt-1 w-full rounded border border-ink-soft/40 bg-parchment-dark px-2 py-1 text-sm"
      />

      <Field
        id="continent-count"
        label="Continents"
        value={terrain.continentCount.toFixed(0)}
        min={2}
        max={8}
        step={1}
        current={terrain.continentCount}
        onChange={(continentCount) => setTerrain({ continentCount })}
      />
      <Field
        id="continent-size"
        label="Terres émergées"
        value={`${(terrain.continentSize * 100).toFixed(0)} %`}
        min={0}
        max={1}
        step={0.01}
        current={terrain.continentSize}
        onChange={(continentSize) => setTerrain({ continentSize })}
      />
      <Field
        id="roughness"
        label="Relief tourmenté"
        value={`${(terrain.roughness * 100).toFixed(0)} %`}
        min={0}
        max={1}
        step={0.01}
        current={terrain.roughness}
        onChange={(roughness) => setTerrain({ roughness })}
      />

      <button
        type="button"
        onClick={() => void regenerate()}
        disabled={status === 'running'}
        className="mt-3 w-full rounded border border-ink-soft/40 px-2 py-1.5 text-sm hover:bg-parchment-dark disabled:opacity-50"
      >
        {status === 'running' ? 'Formation du monde…' : 'Régénérer'}
      </button>

      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-red-800">
          La génération a échoué : {error}
        </p>
      )}
    </section>
  );
}

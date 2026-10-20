import { useEditStore } from '@/store/editStore';
import { useWorldStore } from '@/store/worldStore';
import { Field } from '@/ui/Field';

const MODES = [
  { id: 'reveal', label: 'Révéler' },
  { id: 'hide', label: 'Cacher' },
] as const;

const BUTTON_CLASS = 'rounded border px-2 py-1 text-xs';

/** Pinceau du brouillard de guerre. Voir docs/partage.md. */
export function FogTool() {
  const brush = useEditStore((s) => s.fogBrush);
  const setBrush = useEditStore((s) => s.setFogBrush);
  const fillFog = useEditStore((s) => s.fillFog);
  const showPreview = useEditStore((s) => s.showFogPreview);
  const setShowPreview = useEditStore((s) => s.setShowFogPreview);
  const fogWidth = useWorldStore((s) => s.fogSize.width);
  const radiusKm = useWorldStore((s) => s.radiusKm);

  // Une cellule de brouillard, mesurée à l'équateur.
  const cellKm = (2 * Math.PI * radiusKm) / fogWidth;

  return (
    <div className="mt-3">
      <div className="flex gap-1">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setBrush({ mode: mode.id })}
            aria-pressed={brush.mode === mode.id}
            className={`${BUTTON_CLASS} ${
              brush.mode === mode.id
                ? 'border-ink bg-ink text-parchment'
                : 'border-ink-soft/40 hover:bg-parchment-dark'
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <Field
        id="fog-radius"
        label="Rayon"
        value={`≈ ${Math.round(brush.radius * cellKm).toLocaleString('fr-FR')} km`}
        min={1}
        max={30}
        step={1}
        current={brush.radius}
        onChange={(radius) => setBrush({ radius })}
      />
      <Field
        id="fog-strength"
        label="Force"
        value={`${(brush.strength * 100).toFixed(0)} %`}
        min={0.05}
        max={1}
        step={0.05}
        current={brush.strength}
        onChange={(strength) => setBrush({ strength })}
      />
      <Field
        id="fog-falloff"
        label="Douceur"
        value={`${(brush.falloff * 100).toFixed(0)} %`}
        min={0}
        max={1}
        step={0.01}
        current={brush.falloff}
        onChange={(falloff) => setBrush({ falloff })}
      />

      <div className="mt-2 flex gap-1">
        <button
          type="button"
          onClick={() => fillFog(255, 'tout révélé')}
          className={`${BUTTON_CLASS} flex-1 border-ink-soft/40 hover:bg-parchment-dark`}
        >
          Tout révéler
        </button>
        <button
          type="button"
          onClick={() => fillFog(0, 'tout caché')}
          className={`${BUTTON_CLASS} flex-1 border-ink-soft/40 hover:bg-parchment-dark`}
        >
          Tout cacher
        </button>
      </div>

      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showPreview}
          onChange={(e) => setShowPreview(e.currentTarget.checked)}
        />
        Garder le voile avec les autres outils
      </label>
      <p className="mt-1 text-xs text-ink-soft">
        Le voile assombrit ce que les joueurs n’ont pas vu. Il suit le terrain quand les anneaux
        tournent.
      </p>
    </div>
  );
}

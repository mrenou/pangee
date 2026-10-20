import { planExport } from '@/render/exportPlan';
import { useExportStore, type ExportOptions } from '@/store/exportStore';
import { downloadBlob } from '@/store/persistence';
import { useWorldStore } from '@/store/worldStore';

const FIELD_CLASS =
  'mt-1 w-full rounded border border-ink-soft/40 bg-parchment-dark px-2 py-1 text-sm';

const DECORATIONS: readonly { readonly id: keyof ExportOptions; readonly label: string }[] = [
  { id: 'applyFog', label: 'Appliquer le brouillard (Terra incognita)' },
  { id: 'compass', label: 'Rose des vents' },
  { id: 'scale', label: 'Échelle' },
  { id: 'date', label: 'Date de campagne' },
  { id: 'border', label: 'Bordure' },
  { id: 'showFaults', label: 'Lignes de faille' },
];

/** Export PNG d'une zone, pour les joueurs. Voir docs/partage.md. */
export function ExportPanel() {
  const rect = useExportStore((s) => s.rect);
  const options = useExportStore((s) => s.options);
  const setOptions = useExportStore((s) => s.setOptions);
  const running = useExportStore((s) => s.running);
  const error = useExportStore((s) => s.error);
  const exporter = useExportStore((s) => s.exporter);
  const render = useExportStore((s) => s.render);
  const worldName = useWorldStore((s) => s.worldName);
  const tDays = useWorldStore((s) => s.tDays);
  const fogRevealed = useWorldStore((s) => s.fog?.some((v) => v > 0) ?? false);

  const plan =
    rect && exporter ? planExport(rect, options.widthPx, exporter.maxTextureSize()) : undefined;

  const suggested = plan && !plan.ok ? plan.suggestedWidthPx : undefined;

  const onExport = async (): Promise<void> => {
    const blob = await render();
    if (blob) downloadBlob(blob, `${worldName || 'pangee'} - jour ${Math.round(tDays)}.png`);
  };

  return (
    <div className="mt-3">
      {!rect && <p className="text-xs text-ink-soft">Tracez sur la carte le cadre à exporter.</p>}

      <label className="mt-2 block text-sm" htmlFor="export-width">
        Largeur de l’image (px)
      </label>
      <input
        id="export-width"
        type="number"
        min={16}
        step={100}
        value={options.widthPx}
        onChange={(e) => setOptions({ widthPx: Number(e.currentTarget.value) })}
        className={FIELD_CLASS}
      />
      {plan?.ok && (
        <p className="mt-1 text-xs text-ink-soft">
          {plan.value.widthPx} × {plan.value.heightPx} px
        </p>
      )}
      {plan && !plan.ok && (
        <p role="alert" className="mt-1 text-xs text-red-800">
          {plan.error}{' '}
          {suggested !== undefined && (
            <button
              type="button"
              className="underline"
              onClick={() => setOptions({ widthPx: suggested })}
            >
              Utiliser {suggested} px
            </button>
          )}
        </p>
      )}

      <label className="mt-2 block text-sm" htmlFor="export-title">
        Titre du cartouche
      </label>
      <input
        id="export-title"
        type="text"
        value={options.title}
        placeholder="Aucun cartouche"
        onChange={(e) => setOptions({ title: e.currentTarget.value })}
        className={FIELD_CLASS}
      />

      <div className="mt-2 space-y-1">
        {DECORATIONS.map((d) => (
          <label key={d.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options[d.id] === true}
              onChange={(e) => setOptions({ [d.id]: e.currentTarget.checked })}
            />
            {d.label}
          </label>
        ))}
      </div>
      {options.applyFog && !fogRevealed && (
        <p className="mt-1 text-xs text-ink-soft">
          Rien n’est encore révélé : l’image sera un parchemin vierge. Révélez des zones avec
          l’outil Brouillard, ou décochez le brouillard.
        </p>
      )}

      <button
        type="button"
        onClick={() => void onExport()}
        disabled={!plan?.ok || running}
        className="mt-3 w-full rounded border border-ink-soft/40 px-2 py-1.5 text-sm hover:bg-parchment-dark disabled:opacity-50"
      >
        {running ? 'Rendu en cours…' : 'Exporter en PNG'}
      </button>
      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-soft">
        L’image est rendue à la date courante, dans le navigateur, sans aucun envoi réseau.
      </p>
    </div>
  );
}

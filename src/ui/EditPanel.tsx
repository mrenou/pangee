import { useRef } from 'react';
import { Biome } from '@/climate';
import { useEditStore, type Tool } from '@/store/editStore';
import { useWorldStore } from '@/store/worldStore';
import { Field } from '@/ui/Field';
import { CreatureInspector } from '@/ui/CreatureInspector';
import { ExportPanel } from '@/ui/ExportPanel';
import { FogTool } from '@/ui/FogTool';
import { PlaceInspector } from '@/ui/PlaceInspector';
import { RoadInspector } from '@/ui/RoadInspector';

const TOOLS: readonly { readonly id: Tool; readonly label: string; readonly hint: string }[] = [
  { id: 'pan', label: 'Déplacer', hint: 'Glisser pour déplacer la carte' },
  { id: 'relief', label: 'Relief', hint: 'Sculpter le terrain' },
  { id: 'biome', label: 'Biome', hint: 'Forcer un biome' },
  {
    id: 'place',
    label: 'Lieu',
    hint: 'Cliquer pour poser un lieu, ou ouvrir celui qui est dessous',
  },
  {
    id: 'road',
    label: 'Route',
    hint: 'Cliquer pour tracer, double-clic ou Échap pour finir, Retour arrière pour retirer un tronçon',
  },
  {
    id: 'creature',
    label: 'Créature',
    hint: 'Tracer la trajectoire d’un dragon, d’un navire, d’oiseaux ou d’un serpent de mer',
  },
  { id: 'fog', label: 'Brouillard', hint: 'Révéler aux joueurs ce qu’ils ont découvert' },
  { id: 'export', label: 'Image', hint: 'Cadrer à la souris la zone à exporter en PNG' },
];

const RELIEF_MODES = [
  { id: 'raise', label: 'Monter' },
  { id: 'lower', label: 'Baisser' },
  { id: 'smooth', label: 'Lisser' },
  { id: 'flatten', label: 'Aplatir' },
] as const;

const BIOMES = [
  { id: Biome.Auto, label: 'Automatique' },
  { id: Biome.TemperateForest, label: 'Forêt tempérée' },
  { id: Biome.Taiga, label: 'Taïga' },
  { id: Biome.Steppe, label: 'Steppe' },
  { id: Biome.Desert, label: 'Désert' },
  { id: Biome.Savanna, label: 'Savane' },
  { id: Biome.TropicalRainforest, label: 'Forêt tropicale' },
  { id: Biome.Marsh, label: 'Marais' },
  { id: Biome.Tundra, label: 'Toundra' },
  { id: Biome.Ice, label: 'Glace' },
  { id: Biome.Alpine, label: 'Roche nue' },
] as const;

/** Outils du MJ. Voir docs/editeur.md. */
export function EditPanel() {
  const tool = useEditStore((s) => s.tool);
  const setTool = useEditStore((s) => s.setTool);
  const relief = useEditStore((s) => s.relief);
  const setRelief = useEditStore((s) => s.setRelief);
  const setReliefMode = useEditStore((s) => s.setReliefMode);
  const biomeShape = useEditStore((s) => s.biomeShape);
  const setBiomeShape = useEditStore((s) => s.setBiomeShape);
  const biomeValue = useEditStore((s) => s.biomeValue);
  const setBiomeValue = useEditStore((s) => s.setBiomeValue);

  const canUndo = useEditStore((s) => s.canUndo);
  const canRedo = useEditStore((s) => s.canRedo);
  const undoLabel = useEditStore((s) => s.undoLabel);
  const undo = useEditStore((s) => s.undo);
  const redo = useEditStore((s) => s.redo);

  const hint = TOOLS.find((t) => t.id === tool)?.hint ?? '';

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Outils</h2>

      <div className="mt-2 flex flex-wrap gap-1">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTool(entry.id)}
            aria-pressed={tool === entry.id}
            className={`rounded border px-2 py-1 text-xs ${
              tool === entry.id
                ? 'border-ink bg-ink text-parchment'
                : 'border-ink-soft/40 hover:bg-parchment-dark'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-soft">{hint}</p>

      {tool === 'relief' && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-1">
            {RELIEF_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setReliefMode(mode.id)}
                aria-pressed={relief.mode === mode.id}
                className={`rounded border px-2 py-1 text-xs ${
                  relief.mode === mode.id
                    ? 'border-ink bg-ink text-parchment'
                    : 'border-ink-soft/40 hover:bg-parchment-dark'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <Field
            id="brush-radius"
            label="Rayon"
            value={`${relief.radius.toFixed(0)} cellules`}
            min={1}
            max={60}
            step={1}
            current={relief.radius}
            onChange={(radius) => setRelief({ radius })}
          />
          <Field
            id="brush-strength"
            label="Force"
            value={`${relief.strengthM.toFixed(0)} m`}
            min={5}
            max={800}
            step={5}
            current={relief.strengthM}
            onChange={(strengthM) => setRelief({ strengthM })}
          />
          <Field
            id="brush-falloff"
            label="Douceur"
            value={`${(relief.falloff * 100).toFixed(0)} %`}
            min={0}
            max={1}
            step={0.01}
            current={relief.falloff}
            onChange={(falloff) => setRelief({ falloff })}
          />
          {relief.mode === 'flatten' && (
            <Field
              id="brush-target"
              label="Altitude visée"
              value={`${(relief.targetM ?? 0).toFixed(0)} m`}
              min={-4000}
              max={6000}
              step={50}
              current={relief.targetM ?? 0}
              onChange={(targetM) => setRelief({ targetM })}
            />
          )}
        </div>
      )}

      {tool === 'biome' && (
        <div className="mt-3">
          <label className="block text-sm" htmlFor="biome-value">
            Biome posé
          </label>
          <select
            id="biome-value"
            value={biomeValue}
            onChange={(e) => setBiomeValue(Number(e.currentTarget.value))}
            className="mt-1 w-full rounded border border-ink-soft/40 bg-parchment-dark px-2 py-1 text-sm"
          >
            {BIOMES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-soft">
            « Automatique » efface le forçage et rend la main au climat.
          </p>

          <Field
            id="biome-radius"
            label="Rayon"
            value={`${biomeShape.radius.toFixed(0)} cellules`}
            min={1}
            max={60}
            step={1}
            current={biomeShape.radius}
            onChange={(radius) => setBiomeShape({ radius })}
          />
        </div>
      )}

      {tool === 'place' && <PlaceInspector />}
      {tool === 'creature' && <CreatureInspector />}
      {tool === 'fog' && <FogTool />}
      {tool === 'export' && <ExportPanel />}

      {tool === 'road' && <RoadInspector />}

      <div className="mt-3 flex gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          className="flex-1 rounded border border-ink-soft/40 px-2 py-1 text-xs hover:bg-parchment-dark disabled:opacity-40"
        >
          Annuler{undoLabel ? ` : ${undoLabel}` : ''}
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          className="rounded border border-ink-soft/40 px-2 py-1 text-xs hover:bg-parchment-dark disabled:opacity-40"
        >
          Rétablir
        </button>
      </div>
    </section>
  );
}

/** Enregistrement, export et import de mondes. Voir docs/fichier-pangee.md. */
export function FilePanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const exportWorld = useWorldStore((s) => s.exportWorld);
  const importWorld = useEditStore((s) => s.importWorld);
  const edited = useEditStore((s) => s.edited);
  const error = useWorldStore((s) => s.error);

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Le fichier</h2>
      <div className="mt-2 flex gap-1">
        <button
          type="button"
          onClick={() => exportWorld()}
          className="flex-1 rounded border border-ink-soft/40 px-2 py-1 text-xs hover:bg-parchment-dark"
        >
          Exporter
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex-1 rounded border border-ink-soft/40 px-2 py-1 text-xs hover:bg-parchment-dark"
        >
          Importer
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pangee,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          if (
            edited &&
            !window.confirm(
              'Ce monde a été édité, importer un fichier le remplacera. Exportez-le d’abord pour le garder. Continuer ?',
            )
          ) {
            return;
          }
          void importWorld(file);
        }}
      />
      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-soft">
        Le monde est aussi enregistré dans le navigateur après chaque édition.
      </p>
    </section>
  );
}

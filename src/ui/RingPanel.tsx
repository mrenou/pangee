import { kmPerDay, midLat, ringOffsetsDeg } from '@/model/time';
import { RING_IDS, type RingId } from '@/model/ring';
import { useWorldStore } from '@/store/worldStore';
import { Field } from '@/ui/Field';

const RING_LABELS: Readonly<Record<RingId, string>> = {
  north: 'Anneau nord',
  equator: 'Anneau équatorial',
  south: 'Anneau sud',
};

function formatSpeed(omegaDegPerDay: number, kmParJour: number): string {
  if (omegaDegPerDay === 0) return 'immobile';
  const direction = omegaDegPerDay > 0 ? 'est' : 'ouest';
  return `${Math.abs(kmParJour).toFixed(1)} km/j vers l’${direction}`;
}

/**
 * Réglage des anneaux, de la date et du niveau de la mer.
 * Présentation uniquement : les conversions viennent de src/model/time.
 * Voir docs/temps.md.
 */
export function RingPanel() {
  const cfg = useWorldStore((s) => s.ringConfig);
  const tDays = useWorldStore((s) => s.tDays);
  const radiusKm = useWorldStore((s) => s.radiusKm);
  const seaLevelM = useWorldStore((s) => s.seaLevelM);
  const showFaults = useWorldStore((s) => s.showFaults);
  const setTDays = useWorldStore((s) => s.setTDays);
  const setOmega = useWorldStore((s) => s.setOmega);
  const setCut = useWorldStore((s) => s.setCut);
  const setSeaLevel = useWorldStore((s) => s.setSeaLevel);
  const setShowFaults = useWorldStore((s) => s.setShowFaults);

  const offsets = ringOffsetsDeg(cfg, tDays);
  const years = Math.floor(tDays / 365);

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Le temps</h2>

      <Field
        id="tDays"
        label="Date de campagne"
        value={`an ${years} · ${Math.round(tDays)} j`}
        min={0}
        max={73_000}
        step={1}
        current={tDays}
        onChange={setTDays}
      />
      <p className="mt-1 text-xs text-ink-soft">
        {tDays === cfg.t0
          ? 'Le monde d’avant le Cataclysme : les anneaux sont alignés.'
          : `Décalages : ${offsets.north.toFixed(1)}° · ${offsets.equator.toFixed(1)}° · ${offsets.south.toFixed(1)}°`}
      </p>
      <button
        type="button"
        onClick={() => setTDays(cfg.t0)}
        className="mt-2 rounded border border-ink-soft/40 px-2 py-1 text-xs hover:bg-parchment-dark"
      >
        Revenir au Cataclysme
      </button>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        Les anneaux
      </h2>

      {RING_IDS.map((id) => {
        const omega = cfg.rings[id].omegaDegPerDay;
        return (
          <Field
            key={id}
            id={`omega-${id}`}
            label={RING_LABELS[id]}
            value={formatSpeed(omega, kmPerDay(omega, midLat(id, cfg), radiusKm))}
            min={-0.5}
            max={0.5}
            step={0.001}
            current={omega}
            onChange={(value) => setOmega(id, value)}
          />
        );
      })}

      <Field
        id="cut-north"
        label="Coupure nord"
        value={`${cfg.cutNorthLat.toFixed(0)}°`}
        min={-88}
        max={88}
        step={1}
        current={cfg.cutNorthLat}
        onChange={(lat) => setCut('north', lat)}
      />
      <Field
        id="cut-south"
        label="Coupure sud"
        value={`${cfg.cutSouthLat.toFixed(0)}°`}
        min={-88}
        max={88}
        step={1}
        current={cfg.cutSouthLat}
        onChange={(lat) => setCut('south', lat)}
      />

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        La planète
      </h2>

      <Field
        id="sea-level"
        label="Niveau de la mer"
        value={`${seaLevelM.toFixed(0)} m`}
        min={-2000}
        max={2000}
        step={10}
        current={seaLevelM}
        onChange={setSeaLevel}
      />

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showFaults}
          onChange={(e) => setShowFaults(e.currentTarget.checked)}
          className="accent-ink-soft"
        />
        Marquer les lignes de faille
      </label>
    </section>
  );
}

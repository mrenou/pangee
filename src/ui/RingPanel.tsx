import { useWorldStore } from '@/store/worldStore';
import { kmPerDay, midLat } from '@/model/time';
import { RING_IDS, type RingId } from '@/model/ring';

const RING_LABELS: Readonly<Record<RingId, string>> = {
  north: 'Anneau nord',
  equator: 'Anneau équatorial',
  south: 'Anneau sud',
};

/**
 * Panneau de réglage des anneaux et de la date. Présentation uniquement :
 * la conversion en km/jour vient de src/model. Voir docs/temps.md.
 */
export function RingPanel() {
  const rings = useWorldStore((s) => s.ringConfig.rings);
  const cfg = useWorldStore((s) => s.ringConfig);
  const tDays = useWorldStore((s) => s.tDays);
  const radiusKm = useWorldStore((s) => s.radiusKm);
  const setTDays = useWorldStore((s) => s.setTDays);
  const setOmega = useWorldStore((s) => s.setOmega);

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-ink-soft/30 bg-parchment p-4">
      <h1 className="text-xl font-semibold">Pangée</h1>

      <section className="mt-4">
        <label className="block text-sm" htmlFor="tDays">
          Date de campagne
          <span className="ml-2 tabular-nums text-ink-soft">
            {Math.round(tDays)} j après le Cataclysme
          </span>
        </label>
        <input
          id="tDays"
          type="range"
          min={0}
          max={36500}
          step={1}
          value={tDays}
          onChange={(e) => setTDays(Number(e.currentTarget.value))}
          className="mt-1 w-full"
        />
      </section>

      {RING_IDS.map((id) => {
        const omega = rings[id].omegaDegPerDay;
        const speed = kmPerDay(omega, midLat(id, cfg), radiusKm);
        return (
          <section key={id} className="mt-4">
            <label className="block text-sm" htmlFor={`omega-${id}`}>
              {RING_LABELS[id]}
              <span className="ml-2 tabular-nums text-ink-soft">
                {omega === 0
                  ? 'immobile'
                  : `${Math.abs(speed).toFixed(1)} km/j vers ${omega > 0 ? "l'est" : "l'ouest"}`}
              </span>
            </label>
            <input
              id={`omega-${id}`}
              type="range"
              min={-2}
              max={2}
              step={0.001}
              value={omega}
              onChange={(e) => setOmega(id, Number(e.currentTarget.value))}
              className="mt-1 w-full"
            />
          </section>
        );
      })}
    </aside>
  );
}

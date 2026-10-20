import { useState } from 'react';
import { kmPerDay, midLat, ringOffsetsDeg } from '@/model/time';
import { MAX_RINGS, type Ring } from '@/model/ring';
import { useEditStore } from '@/store/editStore';
import { useHydroStore } from '@/store/hydroStore';
import { MAX_T_DAYS, useWorldStore } from '@/store/worldStore';
import { Field } from '@/ui/Field';

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
  const seaLevelM = useWorldStore((s) => s.seaLevelM);
  const showFaults = useWorldStore((s) => s.showFaults);
  const setTDays = useWorldStore((s) => s.setTDays);
  const setSeaLevel = useWorldStore((s) => s.setSeaLevel);
  const setShowFaults = useWorldStore((s) => s.setShowFaults);
  const animate = useWorldStore((s) => s.animate);
  const setAnimate = useWorldStore((s) => s.setAnimate);
  const bookStyle = useWorldStore((s) => s.bookStyle);
  const setBookStyle = useWorldStore((s) => s.setBookStyle);

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
        max={MAX_T_DAYS}
        step={1}
        current={tDays}
        onChange={setTDays}
      />
      <p className="mt-1 text-xs text-ink-soft">
        {tDays === cfg.t0
          ? 'Le monde d’avant le Cataclysme : les anneaux sont alignés.'
          : `Décalages : ${offsets.map((offset) => `${offset.toFixed(1)}°`).join(' · ')}`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setTDays(cfg.t0)}
          className="rounded border border-ink-soft/40 px-2 py-1 text-xs hover:bg-parchment-dark"
        >
          Revenir au Cataclysme
        </button>
        <TimelapseControls />
      </div>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        Les anneaux
      </h2>

      <RingsEditor />

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

      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={bookStyle}
          onChange={(e) => setBookStyle(e.currentTarget.checked)}
          className="accent-ink-soft"
        />
        Habillage carte de livre
      </label>

      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={animate}
          onChange={(e) => setAnimate(e.currentTarget.checked)}
          className="accent-ink-soft"
        />
        Animer l’eau, les volcans et les créatures
      </label>

      <HydroStatus />
    </section>
  );
}

const BUTTON_CLASS =
  'rounded border border-ink-soft/40 px-2 py-0.5 text-xs hover:bg-parchment-dark disabled:opacity-40';

/**
 * Les anneaux du nord au sud, et les coupures qui les séparent. Tout est
 * annulable : scinder et fusionner, mais aussi chaque glissement d'un curseur
 * de vitesse ou de coupure, qui ne fait qu'une commande. Voir docs/editeur.md
 * et docs/modele-monde.md.
 */
function RingsEditor() {
  const cfg = useWorldStore((s) => s.ringConfig);
  const radiusKm = useWorldStore((s) => s.radiusKm);
  const setRingSpeed = useEditStore((s) => s.setRingSpeed);
  const holdRingGesture = useEditStore((s) => s.holdRingGesture);
  const releaseRingGesture = useEditStore((s) => s.releaseRingGesture);
  const splitRing = useEditStore((s) => s.splitRing);
  const mergeAtCut = useEditStore((s) => s.mergeAtCut);
  const moveCut = useEditStore((s) => s.moveCut);
  const full = cfg.rings.length >= MAX_RINGS;

  return (
    <div>
      {cfg.rings.map((ring, index) => {
        const omega = ring.omegaDegPerDay;
        const cut = cfg.cutsLat[index];
        return (
          <div key={ring.id}>
            <div className="mt-3 rounded border border-ink-soft/20 p-2">
              <div className="flex items-center gap-1">
                <RingName ring={ring} />
                <button
                  type="button"
                  onClick={() => splitRing(index)}
                  disabled={full}
                  title={full ? `${MAX_RINGS} anneaux au plus` : 'Couper cet anneau en deux'}
                  className={BUTTON_CLASS}
                >
                  Scinder
                </button>
              </div>
              <Field
                id={`omega-${ring.id}`}
                label={ring.name}
                value={formatSpeed(omega, kmPerDay(omega, midLat(index, cfg), radiusKm))}
                min={-0.5}
                max={0.5}
                step={0.001}
                current={omega}
                onChange={(value) => setRingSpeed(ring.id, value)}
                onHold={holdRingGesture}
                onRelease={releaseRingGesture}
              />
            </div>
            {cut !== undefined && (
              <div className="flex items-end gap-1">
                <div className="flex-1">
                  <Field
                    id={`cut-${index}`}
                    label={`Coupure ${index + 1}`}
                    value={`${cut.toFixed(0)}°`}
                    min={-89}
                    max={89}
                    step={1}
                    current={cut}
                    onChange={(lat) => moveCut(index, lat)}
                    onHold={holdRingGesture}
                    onRelease={releaseRingGesture}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => mergeAtCut(index)}
                  title="Supprimer cette coupure : les deux anneaux n’en font plus qu’un"
                  className={`${BUTTON_CLASS} mb-0.5`}
                >
                  Fusionner
                </button>
              </div>
            )}
          </div>
        );
      })}
      <p className="mt-2 text-xs text-ink-soft">
        {cfg.rings.length} anneau{cfg.rings.length > 1 ? 'x' : ''} sur {MAX_RINGS} possibles.
      </p>
    </div>
  );
}

/** Nom d'un anneau, validé à la sortie du champ. */
function RingName({ ring }: { readonly ring: Ring }) {
  const setRingName = useWorldStore((s) => s.setRingName);
  const [name, setName] = useState(ring.name);
  return (
    <input
      aria-label={`Intitulé de l’anneau ${ring.name}`}
      value={name}
      onChange={(e) => setName(e.currentTarget.value)}
      onBlur={() => {
        const trimmed = name.trim();
        if (trimmed === '') setName(ring.name);
        else if (trimmed !== ring.name) setRingName(ring.id, trimmed);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm font-medium hover:border-ink-soft/30"
    />
  );
}

const PLAY_SPEEDS = [1, 10, 30, 100, 365] as const;

/** Lecture de la date : les anneaux tournent sous les yeux du MJ. Voir docs/temps.md. */
function TimelapseControls() {
  const playing = useWorldStore((s) => s.playing);
  const setPlaying = useWorldStore((s) => s.setPlaying);
  const speed = useWorldStore((s) => s.playSpeedDaysPerS);
  const setSpeed = useWorldStore((s) => s.setPlaySpeed);

  return (
    <>
      <button
        type="button"
        onClick={() => setPlaying(!playing)}
        aria-pressed={playing}
        className="rounded border border-ink-soft/40 px-2 py-1 text-xs hover:bg-parchment-dark"
      >
        {playing ? '❚❚ Pause' : '▶ Lire'}
      </button>
      <label className="sr-only" htmlFor="play-speed">
        Vitesse de lecture
      </label>
      <select
        id="play-speed"
        value={speed}
        onChange={(e) => setSpeed(Number(e.currentTarget.value))}
        className="rounded border border-ink-soft/40 bg-parchment-dark px-1 py-1 text-xs"
      >
        {PLAY_SPEEDS.map((daysPerS) => (
          <option key={daysPerS} value={daysPerS}>
            {daysPerS} j/s
          </option>
        ))}
      </select>
    </>
  );
}

/** État du dernier calcul hydrologique. Voir docs/hydrologie.md. */
function HydroStatus() {
  const computing = useHydroStore((s) => s.computing);
  const version = useHydroStore((s) => s.waterVersion);
  const lakeCount = useHydroStore((s) => s.lakeCount);
  const elapsedMs = useHydroStore((s) => s.lastElapsedMs);
  const error = useHydroStore((s) => s.error);

  if (error !== undefined) {
    return (
      <p role="alert" className="mt-3 text-xs text-red-800">
        L’hydrologie a échoué : {error}
      </p>
    );
  }

  return (
    // Les attributs de données portent l'état brut : les tests de bout en bout
    // s'en servent pour attendre un nouveau calcul et lire ses chiffres, sans
    // dépendre d'un texte localisé.
    <p
      className="mt-3 text-xs text-ink-soft"
      data-hydro-version={version}
      data-hydro-lakes={lakeCount}
      data-hydro-elapsed-ms={Math.round(elapsedMs)}
      data-hydro-computing={computing ? 'true' : 'false'}
    >
      {computing
        ? 'Les eaux cherchent leur chemin…'
        : `${lakeCount.toLocaleString('fr-FR')} lacs · calcul en ${Math.round(elapsedMs)} ms`}
    </p>
  );
}

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { targetsOf, TUTORIAL_STEPS } from '@/store/tutorialSteps';
import { useTutorialStore } from '@/store/tutorialStore';
import { useWorldStore } from '@/store/worldStore';

const BUTTON_CLASS =
  'rounded border border-ink-soft/40 px-2 py-1 text-xs hover:bg-parchment-dark disabled:opacity-40';
const PRIMARY_CLASS = 'rounded border border-ink bg-ink px-2 py-1 text-xs text-parchment';

/** Ouvre le tutoriel ; il n'y a rien à montrer tant que le monde n'est pas chargé. */
export function TutorialButton() {
  const start = useTutorialStore((s) => s.start);
  const active = useTutorialStore((s) => s.active);
  const ready = useWorldStore((s) => s.height !== undefined);
  return (
    <button
      type="button"
      onClick={start}
      disabled={!ready || active}
      title="Découvrir chaque fonctionnalité en la manipulant"
      className={BUTTON_CLASS}
    >
      Tutoriel
    </button>
  );
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Bord gauche du panneau qui contient l'élément : la fiche se pose à côté. */
  readonly panelLeft: number;
}

/** Premier élément visible portant l'une de ces marques `data-tutorial`. */
function findTarget(keys: readonly string[]): HTMLElement | undefined {
  for (const key of keys) {
    const element = document.querySelector<HTMLElement>(`[data-tutorial="${key}"]`);
    if (element && element.offsetWidth > 0 && element.offsetHeight > 0) return element;
  }
  return undefined;
}

/**
 * Suit la position de l'élément désigné : le panneau défile, les fiches
 * s'ouvrent et se ferment sous lui. On ne relit le cadre qu'une fois par
 * image, et on ne rend que s'il a bougé.
 */
function useTargetBox(keys: readonly string[]): Box | undefined {
  const [box, setBox] = useState<Box>();
  const signature = keys.join(' ');

  useEffect(() => {
    const wanted = signature === '' ? [] : signature.split(' ');
    findTarget(wanted)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    let last: string | undefined;
    let frame = 0;
    const track = (): void => {
      const element = findTarget(wanted);
      const rect = element?.getBoundingClientRect();
      const panelLeft = element?.closest('aside')?.getBoundingClientRect().left ?? rect?.left;
      const key = rect ? `${rect.left} ${rect.top} ${rect.width} ${rect.height} ${panelLeft}` : '';
      if (key !== last) {
        last = key;
        setBox(
          rect && {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            panelLeft: panelLeft ?? rect.left,
          },
        );
      }
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [signature]);

  return box;
}

const MARGIN_PX = 16;
const CARD_WIDTH_PX = 320;

/**
 * Où poser la fiche : à gauche du panneau, à hauteur de l'élément ; dans un coin de la
 * carte quand c'est elle qu'on manipule, au centre sinon.
 */
function cardPlacement(box: Box | undefined, cardHeightPx: number): CSSProperties {
  if (!box) return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (box.width > window.innerWidth / 2) {
    return {
      left: box.left + MARGIN_PX,
      bottom: window.innerHeight - (box.top + box.height) + MARGIN_PX,
    };
  }
  const maxTop = window.innerHeight - cardHeightPx - MARGIN_PX;
  return {
    left: Math.max(MARGIN_PX, box.panelLeft - CARD_WIDTH_PX - MARGIN_PX),
    top: Math.max(MARGIN_PX, Math.min(box.top, maxTop)),
  };
}

/**
 * Le tutoriel à l'écran : un cadre autour de l'élément dont il parle, et une
 * fiche qui l'explique et dit quoi en faire. Rien ne bloque la souris : le MJ
 * manipule l'application elle-même. Voir docs/tutoriel.md.
 */
export function TutorialOverlay() {
  const active = useTutorialStore((s) => s.active);
  const stepIndex = useTutorialStore((s) => s.stepIndex);
  const done = useTutorialStore((s) => s.done);
  const closing = useTutorialStore((s) => s.closing);

  const step = TUTORIAL_STEPS[stepIndex];
  const box = useTargetBox(active && step && !closing ? targetsOf(step, done) : []);

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeightPx, setCardHeightPx] = useState(0);
  // La fiche grandit avec ses consignes : sa hauteur décide de sa place.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => setCardHeightPx(card.offsetHeight));
    observer.observe(card);
    setCardHeightPx(card.offsetHeight);
    return () => observer.disconnect();
  }, [active]);

  if (!active || !step) return null;

  return (
    <>
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 rounded border-2 border-amber-700 transition-all duration-200"
          style={{
            left: box.left - 4,
            top: box.top - 4,
            width: box.width + 8,
            height: box.height + 8,
            boxShadow: '0 0 0 9999px rgba(43, 33, 24, 0.35)',
          }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-40 bg-ink/40" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-label="Tutoriel"
        className="fixed z-50 rounded border border-ink-soft/40 bg-parchment p-4 shadow-xl"
        style={{ width: CARD_WIDTH_PX, ...cardPlacement(closing ? undefined : box, cardHeightPx) }}
      >
        {closing ? <ClosingCard /> : <StepCard />}
      </div>
    </>
  );
}

function StepCard() {
  const stepIndex = useTutorialStore((s) => s.stepIndex);
  const done = useTutorialStore((s) => s.done);
  const goTo = useTutorialStore((s) => s.goTo);
  const requestClose = useTutorialStore((s) => s.requestClose);

  const step = TUTORIAL_STEPS[stepIndex];
  if (!step) return null;
  const last = stepIndex === TUTORIAL_STEPS.length - 1;
  const complete = done.every(Boolean);
  const current = done.findIndex((value) => !value);

  return (
    <>
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wide text-ink-soft">
          Étape {stepIndex + 1} sur {TUTORIAL_STEPS.length}
        </p>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Quitter le tutoriel"
          className="text-sm leading-none text-ink-soft hover:text-ink"
        >
          ✕
        </button>
      </div>
      <div className="mt-1 h-1 w-full rounded bg-parchment-dark">
        <div
          className="h-1 rounded bg-ink-soft transition-all"
          style={{ width: `${((stepIndex + 1) / TUTORIAL_STEPS.length) * 100}%` }}
        />
      </div>

      <h2 className="mt-3 text-lg font-semibold">{step.title}</h2>
      {step.body.map((paragraph) => (
        <p key={paragraph} className="mt-2 text-sm leading-snug">
          {paragraph}
        </p>
      ))}

      {step.tasks.length > 0 && (
        <ul className="mt-3 space-y-1" aria-live="polite">
          {step.tasks.map((task, index) => (
            <li
              key={task.label}
              data-done={done[index] === true}
              className={`flex gap-2 text-sm ${
                done[index]
                  ? 'text-ink-soft line-through'
                  : index === current
                    ? 'font-semibold'
                    : 'text-ink-soft'
              }`}
            >
              <span aria-hidden className="w-4 shrink-0 text-center">
                {done[index] ? '✓' : index === current ? '→' : '·'}
              </span>
              <span>{task.label}</span>
            </li>
          ))}
        </ul>
      )}
      {step.tasks.length > 0 && complete && (
        <p className="mt-2 text-sm font-semibold text-emerald-800">Bien joué !</p>
      )}

      <div className="mt-4 flex items-center gap-1">
        {stepIndex > 0 && (
          <button type="button" onClick={() => goTo(stepIndex - 1)} className={BUTTON_CLASS}>
            Précédent
          </button>
        )}
        <span className="flex-1" />
        {last ? (
          <button type="button" onClick={requestClose} className={PRIMARY_CLASS}>
            Terminer
          </button>
        ) : (
          <button
            type="button"
            onClick={() => goTo(stepIndex + 1)}
            className={complete ? PRIMARY_CLASS : BUTTON_CLASS}
          >
            {complete ? (stepIndex === 0 ? 'Commencer' : 'Suivant') : 'Passer'}
          </button>
        )}
      </div>
    </>
  );
}

/** Le monde a changé pendant le tutoriel : le garder, ou revenir en arrière. */
function ClosingCard() {
  const finish = useTutorialStore((s) => s.finish);
  const cancelClose = useTutorialStore((s) => s.cancelClose);

  return (
    <>
      <h2 className="text-lg font-semibold">Quitter le tutoriel</h2>
      <p className="mt-2 text-sm leading-snug">
        Votre monde a changé pendant le tutoriel. Voulez-vous le retrouver tel qu’il était avant ?
        L’historique d’annulation repartira de zéro.
      </p>
      <div className="mt-4 flex flex-col gap-1">
        <button type="button" onClick={() => finish(true)} className={PRIMARY_CLASS}>
          Rétablir mon monde d’avant
        </button>
        <button type="button" onClick={() => finish(false)} className={BUTTON_CLASS}>
          Garder les modifications
        </button>
        <button type="button" onClick={cancelClose} className={BUTTON_CLASS}>
          Reprendre le tutoriel
        </button>
      </div>
    </>
  );
}

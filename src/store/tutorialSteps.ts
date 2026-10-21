/**
 * Parcours du tutoriel : une étape par fonctionnalité, chacune désignant
 * l'élément de l'écran dont elle parle et les gestes que le MJ doit y faire.
 *
 * Ce module ne lit aucun store : une tâche est jugée sur deux relevés de
 * l'état, celui d'entrée dans l'étape et celui du moment. Voir docs/tutoriel.md.
 */

import type { TerrainParams } from '@/gen';
import type { RingConfig } from '@/model/ring';
import type { Viewport, WorldRect } from '@/model/viewport';
import type { Tool } from '@/store/editStore';

/** Ce que le tutoriel observe de l'application. */
export interface Probe {
  readonly viewport: Viewport;
  readonly tDays: number;
  readonly playing: boolean;
  readonly ringConfig: RingConfig;
  readonly seaLevelM: number;
  readonly showFaults: boolean;
  readonly bookStyle: boolean;
  readonly animate: boolean;
  readonly terrain: TerrainParams;
  readonly placeDensity: number;
  readonly tool: Tool;
  readonly selectedPlaceId: string | undefined;
  readonly commandCount: number;
  readonly undoLabel: string | undefined;
  readonly canRedo: boolean;
  readonly exportRect: WorldRect | undefined;
}

export interface TutorialTask {
  /** Consigne, à l'impératif. */
  readonly label: string;
  /** Élément montré tant que la tâche est à faire (attribut `data-tutorial`). */
  readonly target: string;
  /** Accomplie au vu de l'état courant et de celui d'entrée dans l'étape. */
  readonly done: (now: Probe, start: Probe) => boolean;
}

export interface TutorialStep {
  readonly id: string;
  readonly title: string;
  readonly body: readonly string[];
  /** Élément montré quand aucune tâche ne désigne mieux ; absent : carte centrée. */
  readonly target?: string;
  /** Outil remis en main à l'entrée de l'étape. */
  readonly startTool?: Tool;
  readonly tasks: readonly TutorialTask[];
}

/** Une commande a été empilée depuis l'entrée dans l'étape, sous l'un de ces noms. */
const commandSince =
  (...labels: readonly string[]) =>
  (now: Probe, start: Probe): boolean =>
    now.commandCount > start.commandCount &&
    now.undoLabel !== undefined &&
    labels.includes(now.undoLabel);

const toolChosen = (tool: Tool, label: string): TutorialTask => ({
  label: `Choisissez l’outil « ${label} ».`,
  target: `tool-${tool}`,
  done: (now) => now.tool === tool,
});

const omegas = (cfg: RingConfig): string =>
  cfg.rings.map((ring) => `${ring.id}:${ring.omegaDegPerDay}`).join(' ');

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Bienvenue sur Pangée',
    body: [
      'Le Cataclysme a découpé la planète en anneaux de latitude qui tournent chacun à leur vitesse. Les villes se retrouvent coupées en deux, les rivières barrées, les plages dressées en falaises.',
      'Ce tutoriel passe en revue chaque fonctionnalité : l’élément concerné est entouré à l’écran, et une consigne vous le fait manipuler. Vous pouvez passer une étape à tout moment.',
      'Essayez sans crainte : à la fin, vous pourrez rendre à votre monde son état d’avant le tutoriel.',
    ],
    tasks: [],
  },
  {
    id: 'map',
    title: 'La carte',
    body: [
      'La carte montre le monde à la date de campagne. Elle se répète d’est en ouest : la planète n’a pas de bord.',
      'Avec l’outil « Déplacer », glissez pour vous promener ; la molette zoome, quel que soit l’outil.',
    ],
    target: 'map',
    startTool: 'pan',
    tasks: [
      {
        label: 'Faites glisser la carte.',
        target: 'map',
        done: (now, start) =>
          now.viewport.centerLonWorld !== start.viewport.centerLonWorld ||
          now.viewport.centerLat !== start.viewport.centerLat,
      },
      {
        label: 'Zoomez avec la molette.',
        target: 'map',
        done: (now, start) => now.viewport.pixelsPerDegree !== start.viewport.pixelsPerDegree,
      },
    ],
  },
  {
    id: 'date',
    title: 'La date de campagne',
    body: [
      'La date se compte en jours depuis le Cataclysme. Chaque anneau a tourné d’un angle proportionnel à ce temps : la carte d’une date est recalculée, jamais accumulée, et une même date redonne toujours la même carte.',
      'Le terrain glisse aussitôt ; l’eau suit un instant après — rivières détournées, nouveaux lacs.',
    ],
    target: 'date',
    tasks: [
      {
        label: 'Déplacez le curseur de date.',
        target: 'date',
        done: (now, start) => now.tDays !== start.tDays,
      },
    ],
  },
  {
    id: 'timelapse',
    title: 'Le time-lapse',
    body: [
      'La lecture fait avancer la date d’elle-même, au rythme choisi en jours par seconde : les anneaux tournent sous vos yeux.',
      '« Revenir au Cataclysme » ramène au monde d’avant, anneaux alignés.',
    ],
    target: 'timelapse',
    tasks: [
      {
        label: 'Lancez la lecture.',
        target: 'timelapse',
        done: (now) => now.playing,
      },
      {
        label: 'Mettez-la en pause.',
        target: 'timelapse',
        done: (now) => !now.playing,
      },
      {
        label: 'Revenez au Cataclysme.',
        target: 'timelapse',
        done: (now) => now.tDays === now.ringConfig.t0,
      },
    ],
  },
  {
    id: 'ring-speed',
    title: 'La vitesse des anneaux',
    body: [
      'Chaque anneau tourne vers l’est ou vers l’ouest, ou reste immobile. Sa vitesse est donnée en kilomètres par jour à sa latitude médiane.',
      'Le monde est enregistré tel qu’avant le Cataclysme : changer une vitesse ne détruit rien, seule la position à chaque date change. Le nom de l’anneau se modifie en cliquant dessus.',
    ],
    target: 'ring-speed',
    tasks: [
      {
        label: 'Changez la vitesse d’un anneau.',
        target: 'ring-speed',
        done: (now, start) => omegas(now.ringConfig) !== omegas(start.ringConfig),
      },
      {
        label: 'Avancez la date pour voir l’anneau glisser.',
        target: 'date',
        done: (now) => now.tDays !== now.ringConfig.t0,
      },
    ],
  },
  {
    id: 'cuts',
    title: 'Les coupures',
    body: [
      'Les coupures sont les latitudes qui séparent deux anneaux voisins. Les déplacer redessine les anneaux ; lieux, routes et créatures sont réaffectés à leur nouvel anneau.',
      '« Scinder » coupe un anneau en deux, « Fusionner » supprime une coupure. Huit anneaux au plus, et tout s’annule.',
    ],
    target: 'rings',
    tasks: [
      {
        label: 'Déplacez une coupure, ou scindez ou fusionnez un anneau.',
        target: 'rings',
        done: (now, start) =>
          now.ringConfig.cutsLat.join(' ') !== start.ringConfig.cutsLat.join(' '),
      },
    ],
  },
  {
    id: 'sea-level',
    title: 'Le niveau de la mer',
    body: [
      'Le relief est en mètres, fonds marins compris. Relever la mer noie les terres basses, l’abaisser découvre des plateaux continentaux ; l’eau est recalculée.',
    ],
    target: 'sea-level',
    tasks: [
      {
        label: 'Changez le niveau de la mer.',
        target: 'sea-level',
        done: (now, start) => now.seaLevelM !== start.seaLevelM,
      },
    ],
  },
  {
    id: 'display',
    title: 'L’affichage',
    body: [
      'Les lignes de faille marquent les coupures sur la carte. L’habillage « carte de livre » ajoute hachures, symboles et grain du parchemin. Les animations font onduler l’eau, fumer les volcans et voyager les créatures.',
    ],
    target: 'display',
    tasks: [
      {
        label: 'Cochez ou décochez l’une de ces options.',
        target: 'display',
        done: (now, start) =>
          now.showFaults !== start.showFaults ||
          now.bookStyle !== start.bookStyle ||
          now.animate !== start.animate,
      },
    ],
  },
  {
    id: 'relief',
    title: 'Sculpter le relief',
    body: [
      'Le pinceau monte, baisse, lisse ou aplatit le terrain ; rayon, force et douceur se règlent sous les outils.',
      'Peint à n’importe quelle date, le relief suit son anneau : la retouche reste juste à toutes les autres dates. Un trait entier s’annule d’un seul coup.',
    ],
    tasks: [
      toolChosen('relief', 'Relief'),
      {
        label: 'Peignez sur la carte en gardant le bouton enfoncé.',
        target: 'map',
        done: commandSince('coup de pinceau'),
      },
    ],
  },
  {
    id: 'biome',
    title: 'Forcer un biome',
    body: [
      'Les biomes viennent du climat : latitude, altitude, humidité, proximité de l’eau. Le pinceau biome en impose un là où vous peignez ; « Automatique » efface ce forçage.',
    ],
    tasks: [
      toolChosen('biome', 'Biome'),
      {
        label: 'Peignez un biome sur la carte.',
        target: 'map',
        done: commandSince('biome peint'),
      },
    ],
  },
  {
    id: 'place',
    title: 'Les lieux',
    body: [
      'Un clic dans le vide pose un lieu, un clic sur un lieu l’ouvre, un glisser le déplace. La fiche donne son nom, son type, son importance et vos notes de MJ. « Suppr » le retire.',
    ],
    tasks: [
      toolChosen('place', 'Lieu'),
      {
        label: 'Cliquez sur la carte pour poser un lieu, ou sur un lieu existant.',
        target: 'map',
        done: (now, start) =>
          now.selectedPlaceId !== undefined && now.selectedPlaceId !== start.selectedPlaceId,
      },
      {
        label: 'Renommez-le dans sa fiche, puis validez par Entrée.',
        target: 'tool-options',
        done: commandSince('lieu renommé'),
      },
    ],
  },
  {
    id: 'road',
    title: 'Les routes',
    body: [
      'Cliquez point par point ; double-clic ou Échap pour finir, Retour arrière pour retirer le dernier tronçon. « Suivre le relief » fait contourner les montagnes.',
      'Une route coupée par une faille forme deux tronçons qui s’éloignent avec le temps.',
    ],
    tasks: [
      toolChosen('road', 'Route'),
      {
        label: 'Tracez une route de quelques points, puis double-cliquez.',
        target: 'map',
        done: commandSince('route tracée'),
      },
    ],
  },
  {
    id: 'creature',
    title: 'Les créatures',
    body: [
      'Dragons, navires, oiseaux et serpents de mer parcourent la trajectoire que vous leur tracez, en boucle ou en aller-retour, quand les animations sont actives.',
    ],
    tasks: [
      toolChosen('creature', 'Créature'),
      {
        label: 'Posez quelques points de passage, puis double-cliquez.',
        target: 'map',
        done: commandSince('créature ajoutée'),
      },
    ],
  },
  {
    id: 'fog',
    title: 'Le brouillard de guerre',
    body: [
      'Le voile assombrit ce que vos joueurs n’ont pas encore découvert. Révélez au pinceau, ou tout d’un coup. Le brouillard suit le terrain quand les anneaux tournent.',
    ],
    tasks: [
      toolChosen('fog', 'Brouillard'),
      {
        label: 'Révélez une zone au pinceau, ou avec « Tout révéler ».',
        target: 'map',
        done: commandSince('brouillard peint', 'tout révélé', 'tout caché'),
      },
    ],
  },
  {
    id: 'export',
    title: 'Partager une image',
    body: [
      'L’outil Image exporte en PNG la zone cadrée, à la date courante. Le brouillard en fait une carte de joueurs ; cartouche, rose des vents, échelle et date l’habillent.',
      'Le rendu se fait dans le navigateur : rien n’est envoyé nulle part.',
    ],
    tasks: [
      toolChosen('export', 'Image'),
      {
        label: 'Tracez à la souris le cadre à exporter.',
        target: 'map',
        done: (now, start) => now.exportRect !== undefined && now.exportRect !== start.exportRect,
      },
    ],
  },
  {
    id: 'undo',
    title: 'Annuler et rétablir',
    body: [
      'Chaque geste — un trait de pinceau, un lieu, une route, un réglage d’anneau — s’annule d’un clic. Le bouton nomme ce qu’il va défaire.',
    ],
    target: 'undo',
    tasks: [
      {
        label: 'Annulez votre dernier geste.',
        target: 'undo',
        done: (now, start) => now.canRedo && (!start.canRedo || now.undoLabel !== start.undoLabel),
      },
      {
        label: 'Rétablissez-le.',
        target: 'undo',
        done: (now) => !now.canRedo,
      },
    ],
  },
  {
    id: 'world',
    title: 'Générer un monde',
    body: [
      'La graine et ces réglages façonnent un monde procédural : continents, relief, villes nommées. Une même graine redonne toujours le même monde.',
      '« Régénérer » remplace la carte courante, après confirmation si elle a été éditée.',
    ],
    target: 'world',
    tasks: [
      {
        label: 'Modifiez un réglage — inutile de régénérer.',
        target: 'world',
        done: (now, start) =>
          now.terrain !== start.terrain || now.placeDensity !== start.placeDensity,
      },
    ],
  },
  {
    id: 'file',
    title: 'Le fichier',
    body: [
      'Le monde s’enregistre dans le navigateur après chaque édition. « Exporter » en fait un fichier .pangee à garder ou à transmettre, « Importer » le rouvre, et la carte de Pangée livrée avec le site reste toujours à portée.',
    ],
    target: 'file',
    tasks: [],
  },
  {
    id: 'end',
    title: 'À vous de jouer',
    body: [
      'Vous avez fait le tour de Pangée. Le tutoriel se relance à tout moment depuis le bouton en haut du panneau.',
    ],
    tasks: [],
  },
];

/**
 * Juge les tâches d'une étape, dans l'ordre : une tâche ne compte qu'une fois
 * les précédentes faites, et une tâche faite le reste — mettre en pause ne
 * défait pas d'avoir lancé la lecture.
 */
export function advanceTasks(
  tasks: readonly TutorialTask[],
  done: readonly boolean[],
  now: Probe,
  start: Probe,
): readonly boolean[] {
  const next: boolean[] = [];
  let open = true;
  for (const [index, task] of tasks.entries()) {
    const reached: boolean = done[index] === true || (open && task.done(now, start));
    next.push(reached);
    open &&= reached;
  }
  return next;
}

/** Éléments à montrer, du plus précis au plus général. */
export function targetsOf(step: TutorialStep, done: readonly boolean[]): readonly string[] {
  const pending = step.tasks.find((_, index) => done[index] !== true);
  const targets = [pending?.target, step.target].filter((t): t is string => t !== undefined);
  return [...new Set(targets)];
}

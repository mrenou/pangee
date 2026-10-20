/**
 * Commandes d'édition et pile d'annulation.
 *
 * Toute écriture sur le monde passe par une commande : c'est ce qui rend
 * l'annulation possible sans que chaque outil ait à s'en soucier.
 * Voir docs/editeur.md.
 */

import type { Place, RasterSize, Road } from '@/model/world';
import { applyPatch, patchBytes, type RasterPatch } from '@/edit/patch';

/** L'état que les commandes savent modifier. */
export interface EditTarget {
  readonly size: RasterSize;
  readonly height: Float32Array;
  readonly biomeOverride: Uint8Array;
  /** Brouillard de guerre, à sa propre résolution, plus basse que le relief. */
  readonly fogSize: RasterSize;
  readonly fog: Uint8Array;
  places: readonly Place[];
  roads: readonly Road[];
}

export interface Command {
  readonly label: string;
  /**
   * Une commande raster modifie le relief ou l'override : le rendu et le
   * worker hydrologique doivent relire les couches. Une commande de
   * brouillard ne concerne que son calque, une commande vectorielle que les
   * lieux et les routes.
   */
  readonly kind: 'raster' | 'fog' | 'vector';
  /** Coût mémoire, pour borner la pile. */
  readonly bytes: number;
  apply: (target: EditTarget) => void;
  revert: (target: EditTarget) => void;
}

function layerOf(target: EditTarget, patch: RasterPatch): Float32Array | Uint8Array | undefined {
  switch (patch.layer) {
    case 'height':
      return target.height;
    case 'biomeOverride':
      return target.biomeOverride;
    case 'fog':
      return target.fog;
    default:
      // urban n'est pas encore éditable ; la commande est alors sans effet
      // plutôt que silencieusement fausse.
      return undefined;
  }
}

/** Le brouillard a sa propre grille : un patch s'y applique à sa taille. */
function sizeOf(target: EditTarget, patch: RasterPatch): RasterSize {
  return patch.layer === 'fog' ? target.fogSize : target.size;
}

export function rasterCommand(label: string, patch: RasterPatch): Command {
  return {
    label,
    kind: patch.layer === 'fog' ? 'fog' : 'raster',
    bytes: patchBytes(patch),
    apply: (target) => {
      const layer = layerOf(target, patch);
      if (layer) applyPatch(patch, layer, sizeOf(target, patch), 'after');
    },
    revert: (target) => {
      const layer = layerOf(target, patch);
      if (layer) applyPatch(patch, layer, sizeOf(target, patch), 'before');
    },
  };
}

/** Commande légère sur les objets vectoriels : on échange deux listes. */
export function placesCommand(
  label: string,
  before: readonly Place[],
  after: readonly Place[],
): Command {
  return {
    label,
    kind: 'vector',
    bytes: (before.length + after.length) * 128,
    apply: (target) => {
      target.places = after;
    },
    revert: (target) => {
      target.places = before;
    },
  };
}

export function roadsCommand(
  label: string,
  before: readonly Road[],
  after: readonly Road[],
): Command {
  const points = [...before, ...after].reduce((n, road) => n + road.points.length, 0);
  return {
    label,
    kind: 'vector',
    bytes: points * 16,
    apply: (target) => {
      target.roads = after;
    },
    revert: (target) => {
      target.roads = before;
    },
  };
}

/** Budget mémoire de la pile d'annulation. */
export const DEFAULT_MAX_BYTES = 96 * 1024 * 1024;
export const DEFAULT_MAX_DEPTH = 100;

export interface HistoryOptions {
  readonly maxBytes?: number;
  readonly maxDepth?: number;
}

/**
 * Pile d'annulation bornée.
 *
 * Une commande poussée efface la branche de rétablissement : on ne conserve
 * pas d'arbre d'historique, seulement un fil.
 */
export class History {
  private readonly done: Command[] = [];
  private readonly undone: Command[] = [];
  private readonly maxBytes: number;
  private readonly maxDepth: number;
  private bytes = 0;

  constructor(options: HistoryOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  get depth(): number {
    return this.done.length;
  }

  get usedBytes(): number {
    return this.bytes;
  }

  /** Nom de la prochaine annulation, pour l'afficher dans l'interface. */
  get undoLabel(): string | undefined {
    return this.done[this.done.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.undone[this.undone.length - 1]?.label;
  }

  /** Empile une commande déjà appliquée. */
  push(command: Command): void {
    this.done.push(command);
    this.bytes += command.bytes;
    this.undone.length = 0;
    this.trim();
  }

  /** Applique la commande puis l'empile. */
  run(command: Command, target: EditTarget): void {
    command.apply(target);
    this.push(command);
  }

  undo(target: EditTarget): Command | undefined {
    const command = this.done.pop();
    if (!command) return undefined;
    command.revert(target);
    this.bytes -= command.bytes;
    this.undone.push(command);
    return command;
  }

  redo(target: EditTarget): Command | undefined {
    const command = this.undone.pop();
    if (!command) return undefined;
    command.apply(target);
    this.done.push(command);
    this.bytes += command.bytes;
    return command;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this.bytes = 0;
  }

  /** Évince les commandes les plus anciennes hors budget. */
  private trim(): void {
    while (
      this.done.length > this.maxDepth ||
      (this.bytes > this.maxBytes && this.done.length > 1)
    ) {
      const evicted = this.done.shift();
      if (!evicted) break;
      this.bytes -= evicted.bytes;
    }
  }
}

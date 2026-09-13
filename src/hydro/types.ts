/**
 * Contrat de l'étage hydrologique. Voir docs/hydrologie.md.
 */

import type { RasterSize } from '@/model/world';

/** Valeur de waterLevel sur une cellule sèche. */
export const DRY = -1e9;

/** Valeur de flowDir sur une cellule qui ne s'écoule nulle part. */
export const NO_FLOW = 255;

/**
 * Écart minimal imposé entre deux cellules d'un plat, en mètres.
 * Garantit une pente strictement décroissante, donc une direction D8 définie
 * partout. Négligeable devant le relief, mais visible sur les grilles jouets.
 */
export const EPSILON_M = 1e-3;

export interface HydroInput {
  readonly size: RasterSize;
  /** Relief assemblé pour la date courante, en référentiel monde. */
  readonly heightWorld: Float32Array;
  readonly seaLevelM: number;
  /** Pluie reçue par cellule. Uniforme en v1. */
  readonly rainPerCell: number;
}

export interface Lake {
  readonly id: number;
  /** Altitude de la surface, constante sur tout le lac. */
  readonly levelM: number;
  /** Hauteur d'eau au point le plus profond. */
  readonly depthM: number;
  readonly cellCount: number;
  /** Cellule de col par laquelle le lac déborde, -1 s'il n'en a pas. */
  readonly outletIndex: number;
  /** Débit entrant, en unités de pluie. */
  readonly inflow: number;
}

export interface HydroState {
  readonly size: RasterSize;
  /** Relief après remplissage des dépressions : filled >= heightWorld. */
  readonly filled: Float32Array;
  /** Direction d'écoulement D8, ou NO_FLOW. */
  readonly flowDir: Uint8Array;
  /** Surface drainée amont, en unités de pluie. */
  readonly flowAcc: Float32Array;
  /** Altitude de la surface d'eau, ou DRY. */
  readonly waterLevel: Float32Array;
  /** Identifiant de lac, 0 = pas de lac. */
  readonly lakeId: Int32Array;
  /** 1 si la cellule appartient à une mer. */
  readonly isOcean: Uint8Array;
  readonly lakes: readonly Lake[];
}

/** Décalages D8, dans l'ordre d'encodage de flowDir. */
export const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1] as const;
/** Longueur du pas, en cellules : les diagonales sont plus longues. */
export const D8_LENGTH = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2] as const;

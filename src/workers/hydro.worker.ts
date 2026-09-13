/**
 * Worker hydrologique.
 *
 * Il garde le relief local en mémoire : changer la date ne renvoie donc que
 * quelques nombres, pas huit mégaoctets. Voir docs/architecture.md.
 */

import * as Comlink from 'comlink';
import { assembleHeightWorld, computeHydro } from '@/hydro';
import type { RingConfig } from '@/model/ring';
import type { RasterSize } from '@/model/world';

export interface HydroRequest {
  readonly ringConfig: RingConfig;
  readonly tDays: number;
  readonly seaLevelM: number;
  readonly rainPerCell: number;
}

export interface HydroReply {
  readonly size: RasterSize;
  readonly waterLevel: Float32Array;
  readonly flowAcc: Float32Array;
  readonly lakeCount: number;
  readonly elapsedMs: number;
}

let size: RasterSize | undefined;
let heightLocal: Float32Array | undefined;
let heightWorld: Float32Array | undefined;

const api = {
  /** Reçoit une copie du relief local. Appelé à chaque régénération. */
  setHeight(nextSize: RasterSize, height: Float32Array): void {
    size = nextSize;
    heightLocal = height;
    heightWorld = new Float32Array(height.length);
  },

  compute(request: HydroRequest): HydroReply {
    if (!size || !heightLocal || !heightWorld) {
      throw new Error("Le relief n'a pas encore été transmis au worker hydrologique.");
    }

    const started = performance.now();
    assembleHeightWorld(size, heightLocal, request.ringConfig, request.tDays, heightWorld);
    const state = computeHydro({
      size,
      heightWorld,
      seaLevelM: request.seaLevelM,
      rainPerCell: request.rainPerCell,
    });

    // Les tampons de calcul sont réutilisés d'un appel à l'autre : on transfère
    // des copies, sinon le worker les perdrait au premier envoi.
    const waterLevel = new Float32Array(state.waterLevel);
    const flowAcc = new Float32Array(state.flowAcc);

    const reply: HydroReply = {
      size,
      waterLevel,
      flowAcc,
      lakeCount: state.lakes.length,
      elapsedMs: performance.now() - started,
    };
    return Comlink.transfer(reply, [waterLevel.buffer, flowAcc.buffer]);
  },
};

export type HydroApi = typeof api;

Comlink.expose(api);

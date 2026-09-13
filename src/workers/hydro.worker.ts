/**
 * Worker hydrologique.
 *
 * Il garde le relief local en mémoire : changer la date ne renvoie donc que
 * quelques nombres, pas huit mégaoctets. Voir docs/architecture.md.
 */

import * as Comlink from 'comlink';
import { computeBiomes, createClimateBuffers, type ClimateBuffers } from '@/climate';
import { assembleHeightWorld, computeHydro, riverThreshold, DRY } from '@/hydro';
import { extractRivers } from '@/hydro/rivers';
import type { RingConfig } from '@/model/ring';
import type { RasterSize } from '@/model/world';

export interface HydroRequest {
  readonly ringConfig: RingConfig;
  readonly tDays: number;
  readonly seaLevelM: number;
  readonly rainPerCell: number;
  /** Graine du monde, pour que le bruit climatique soit reproductible. */
  readonly seed: string;
}

export interface HydroReply {
  readonly size: RasterSize;
  /** Relief assemblé pour cette date : le semis des symboles s'en sert. */
  readonly heightWorld: Float32Array;
  readonly waterLevel: Float32Array;
  readonly flowAcc: Float32Array;
  /** Biomes dérivés, en référentiel monde. */
  readonly biome: Uint8Array;
  /** Cours d'eau en polylignes, prêts à tracer. */
  readonly riverPoints: Float32Array;
  readonly riverStarts: Int32Array;
  readonly riverThreshold: number;
  readonly lakeCount: number;
  readonly elapsedMs: number;
}

let size: RasterSize | undefined;
let heightLocal: Float32Array | undefined;
let heightWorld: Float32Array | undefined;
let climate: ClimateBuffers | undefined;

const api = {
  /** Reçoit une copie du relief local. Appelé à chaque régénération. */
  setHeight(nextSize: RasterSize, height: Float32Array): void {
    size = nextSize;
    heightLocal = height;
    heightWorld = new Float32Array(height.length);
    climate = createClimateBuffers(nextSize);
  },

  compute(request: HydroRequest): HydroReply {
    if (!size || !heightLocal || !heightWorld || !climate) {
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

    const threshold = riverThreshold(size, request.rainPerCell);

    const isWater = new Uint8Array(state.waterLevel.length);
    for (let i = 0; i < isWater.length; i += 1) {
      isWater[i] = state.waterLevel[i]! > DRY && state.waterLevel[i]! > heightWorld[i]! ? 1 : 0;
    }
    const rivers = extractRivers(size, state.flowAcc, state.flowDir, isWater, threshold);
    computeBiomes(
      {
        size,
        heightWorld,
        waterLevel: state.waterLevel,
        flowAcc: state.flowAcc,
        seaLevelM: request.seaLevelM,
        riverThreshold: threshold,
        seed: request.seed,
      },
      climate,
    );

    // Les tampons de calcul sont réutilisés d'un appel à l'autre : on transfère
    // des copies, sinon le worker les perdrait au premier envoi.
    const assembled = new Float32Array(heightWorld);
    const waterLevel = new Float32Array(state.waterLevel);
    const flowAcc = new Float32Array(state.flowAcc);
    const biome = new Uint8Array(climate.biome);

    const reply: HydroReply = {
      size,
      heightWorld: assembled,
      waterLevel,
      flowAcc,
      biome,
      riverPoints: rivers.points,
      riverStarts: rivers.starts,
      riverThreshold: threshold,
      lakeCount: state.lakes.length,
      elapsedMs: performance.now() - started,
    };
    return Comlink.transfer(reply, [
      assembled.buffer,
      waterLevel.buffer,
      flowAcc.buffer,
      biome.buffer,
      rivers.points.buffer,
      rivers.starts.buffer,
    ]);
  },
};

export type HydroApi = typeof api;

Comlink.expose(api);

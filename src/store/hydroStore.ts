import { create } from 'zustand';
import type { RiverNetwork } from '@/hydro/rivers';
import type { RasterSize } from '@/model/world';
import type { HydroRequest } from '@/workers/hydro.worker';
import { requestHydro, sendHeightToHydro } from '@/workers/hydroClient';

/**
 * Délai avant de relancer l'hydrologie. Le terrain, lui, se décale sans
 * attendre : le curseur de date reste fluide et l'eau rattrape à l'arrêt.
 * Voir docs/temps.md.
 */
export const HYDRO_DEBOUNCE_MS = 150;

export const RAIN_PER_CELL = 1;

export interface WaterLayers {
  readonly size: RasterSize;
  readonly waterLevel: Float32Array;
  readonly flowAcc: Float32Array;
  readonly biome: Uint8Array;
  readonly rivers: RiverNetwork;
  readonly riverThreshold: number;
}

interface HydroState {
  water: WaterLayers | undefined;
  /** Incrémenté à chaque nouvelle couche, pour déclencher le téléversement. */
  waterVersion: number;
  computing: boolean;
  lakeCount: number;
  lastElapsedMs: number;
  error: string | undefined;

  setHeight: (size: RasterSize, height: Float32Array) => Promise<void>;
  schedule: (request: HydroRequest) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useHydroStore = create<HydroState>((set) => ({
  water: undefined,
  waterVersion: 0,
  computing: false,
  lakeCount: 0,
  lastElapsedMs: 0,
  error: undefined,

  setHeight: async (size, height) => {
    await sendHeightToHydro(size, height);
  },

  schedule: (request) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      set({ computing: true, error: undefined });
      void requestHydro(
        request,
        (reply) => {
          set((s) => ({
            water: {
              size: reply.size,
              waterLevel: reply.waterLevel,
              flowAcc: reply.flowAcc,
              biome: reply.biome,
              rivers: { points: reply.riverPoints, starts: reply.riverStarts },
              riverThreshold: reply.riverThreshold,
            },
            waterVersion: s.waterVersion + 1,
            lakeCount: reply.lakeCount,
            lastElapsedMs: reply.elapsedMs,
            computing: false,
          }));
        },
        (message) => set({ error: message, computing: false }),
      );
    }, HYDRO_DEBOUNCE_MS);
  },
}));

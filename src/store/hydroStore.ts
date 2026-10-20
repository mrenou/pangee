import { create } from 'zustand';
import type { RiverNetwork } from '@/hydro/rivers';
import type { RasterSize } from '@/model/world';
import type { HydroRequest } from '@/workers/hydro.worker';
import { requestHydro, sendLayersToHydro } from '@/workers/hydroClient';

/**
 * Délai avant de relancer l'hydrologie. Le terrain, lui, se décale sans
 * attendre : le curseur de date reste fluide et l'eau rattrape à l'arrêt.
 * Voir docs/temps.md.
 */
export const HYDRO_DEBOUNCE_MS = 150;

export const RAIN_PER_CELL = 1;

export interface WaterLayers {
  readonly size: RasterSize;
  readonly heightWorld: Float32Array;
  readonly waterLevel: Float32Array;
  readonly flowAcc: Float32Array;
  readonly biome: Uint8Array;
  readonly rivers: RiverNetwork;
  readonly riverThreshold: number;
  /** Date du calcul : le rendu s'en sert pour compenser le retard. */
  readonly tDays: number;
}

interface HydroState {
  water: WaterLayers | undefined;
  /** Incrémenté à chaque nouvelle couche, pour déclencher le téléversement. */
  waterVersion: number;
  computing: boolean;
  lakeCount: number;
  lastElapsedMs: number;
  error: string | undefined;

  /** Renvoie au worker le relief et l'override, après un nouveau monde ou une édition. */
  setLayers: (size: RasterSize, height: Float32Array, biomeOverride: Uint8Array) => Promise<void>;
  /**
   * Programme un calcul. `immediate` saute le debounce : pendant un time-lapse
   * la date ne s'arrête jamais, un debounce ne laisserait passer aucun calcul.
   * Les demandes restent coalescées par le client du worker.
   */
  schedule: (request: HydroRequest, immediate?: boolean) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useHydroStore = create<HydroState>((set) => ({
  water: undefined,
  waterVersion: 0,
  computing: false,
  lakeCount: 0,
  lastElapsedMs: 0,
  error: undefined,

  setLayers: async (size, height, biomeOverride) => {
    await sendLayersToHydro(size, height, biomeOverride);
  },

  schedule: (request, immediate = false) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const run = (): void => {
      timer = undefined;
      set({ computing: true, error: undefined });
      void requestHydro(
        request,
        (reply) => {
          set((s) => ({
            water: {
              size: reply.size,
              heightWorld: reply.heightWorld,
              waterLevel: reply.waterLevel,
              flowAcc: reply.flowAcc,
              biome: reply.biome,
              rivers: { points: reply.riverPoints, starts: reply.riverStarts },
              riverThreshold: reply.riverThreshold,
              tDays: reply.tDays,
            },
            waterVersion: s.waterVersion + 1,
            lakeCount: reply.lakeCount,
            lastElapsedMs: reply.elapsedMs,
            computing: false,
          }));
        },
        (message) => set({ error: message, computing: false }),
      );
    };
    if (immediate) run();
    else timer = setTimeout(run, HYDRO_DEBOUNCE_MS);
  },
}));

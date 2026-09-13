import { create } from 'zustand';
import { DEFAULT_TERRAIN_PARAMS, MAX_ALTITUDE_M, MAX_DEPTH_M, type TerrainParams } from '@/gen';
import { DEFAULT_RING_CONFIG, type RingConfig, type RingId } from '@/model/ring';
import { DEFAULT_SETTINGS, RASTER_2K, type RasterSize } from '@/model/world';
import { generateWorldInWorker } from '@/workers/genClient';
import { useHydroStore } from '@/store/hydroStore';

export type GenerationStatus = 'idle' | 'running' | 'error';

interface WorldState {
  ringConfig: RingConfig;
  tDays: number;
  radiusKm: number;
  seaLevelM: number;
  showFaults: boolean;

  terrain: TerrainParams;
  rasterSize: RasterSize;
  height: Float32Array | undefined;
  /** Incrémenté à chaque nouveau relief, pour que le rendu sache re-téléverser. */
  heightVersion: number;

  status: GenerationStatus;
  error: string | undefined;

  setTDays: (tDays: number) => void;
  setOmega: (ring: RingId, omegaDegPerDay: number) => void;
  setCut: (which: 'north' | 'south', lat: number) => void;
  setSeaLevel: (seaLevelM: number) => void;
  setShowFaults: (showFaults: boolean) => void;
  setTerrain: (patch: Partial<TerrainParams>) => void;
  regenerate: () => Promise<void>;
}

export const MAX_ALTITUDE = MAX_ALTITUDE_M;
export const MAX_DEPTH = MAX_DEPTH_M;

/**
 * État de l'application. Provisoire : à partir de la phase 4, toute écriture
 * sur le monde passera par une commande annulable de src/edit.
 * Voir docs/editeur.md.
 */
export const useWorldStore = create<WorldState>((set, get) => ({
  ringConfig: DEFAULT_RING_CONFIG,
  tDays: DEFAULT_SETTINGS.tDays,
  radiusKm: DEFAULT_SETTINGS.radiusKm,
  seaLevelM: DEFAULT_SETTINGS.seaLevelM,
  showFaults: true,

  terrain: DEFAULT_TERRAIN_PARAMS,
  rasterSize: RASTER_2K,
  height: undefined,
  heightVersion: 0,

  status: 'idle',
  error: undefined,

  setTDays: (tDays) => set({ tDays }),

  setOmega: (ring, omegaDegPerDay) =>
    set((s) => ({
      ringConfig: {
        ...s.ringConfig,
        rings: { ...s.ringConfig.rings, [ring]: { id: ring, omegaDegPerDay } },
      },
    })),

  setCut: (which, lat) =>
    set((s) => {
      const cutNorthLat = which === 'north' ? lat : s.ringConfig.cutNorthLat;
      const cutSouthLat = which === 'south' ? lat : s.ringConfig.cutSouthLat;
      // L'invariant cutSouthLat < cutNorthLat est maintenu par construction :
      // une coupure pousse l'autre plutôt que de l'enjamber.
      const gap = 1;
      return {
        ringConfig: {
          ...s.ringConfig,
          cutNorthLat: Math.max(cutNorthLat, cutSouthLat + gap),
          cutSouthLat: Math.min(cutSouthLat, cutNorthLat - gap),
        },
      };
    }),

  setSeaLevel: (seaLevelM) => set({ seaLevelM }),
  setShowFaults: (showFaults) => set({ showFaults }),
  setTerrain: (patch) => set((s) => ({ terrain: { ...s.terrain, ...patch } })),

  regenerate: async () => {
    const { rasterSize, terrain } = get();
    set({ status: 'running', error: undefined });
    try {
      const result = await generateWorldInWorker({ size: rasterSize, terrain });
      // Le worker hydrologique garde sa propre copie du relief : changer de
      // date ne lui renverra plus que quelques nombres.
      await useHydroStore.getState().setHeight(result.size, result.height);
      set((s) => ({
        height: result.height,
        rasterSize: result.size,
        heightVersion: s.heightVersion + 1,
        status: 'idle',
      }));
    } catch (cause) {
      // Une erreur de worker doit atteindre l'interface, jamais mourir en
      // silence. Voir docs/conventions.md.
      set({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) });
    }
  },
}));

import { create } from 'zustand';
import {
  DEFAULT_PLACE_DENSITY,
  DEFAULT_TERRAIN_PARAMS,
  MAX_ALTITUDE_M,
  MAX_DEPTH_M,
  type TerrainParams,
} from '@/gen';
import { DEFAULT_RING_CONFIG, type RingConfig, type RingId } from '@/model/ring';
import { DEFAULT_SETTINGS, RASTER_2K, type Place, type RasterSize, type Road } from '@/model/world';
import { generateWorldInWorker } from '@/workers/genClient';
import { useHydroStore } from '@/store/hydroStore';
import { createAutosave, downloadWorld, loadWorld, readWorldFile } from '@/store/persistence';
import type { WorldDocument } from '@/model/file';
import { FOG_DOWNSCALE } from '@/model/world';

export type GenerationStatus = 'idle' | 'running' | 'error';

interface WorldState {
  ringConfig: RingConfig;
  tDays: number;
  radiusKm: number;
  seaLevelM: number;
  showFaults: boolean;
  bookStyle: boolean;

  worldId: string;
  worldName: string;
  fog: Uint8Array | undefined;
  terrain: TerrainParams;
  placeDensity: number;
  places: readonly Place[];
  roads: readonly Road[];
  rasterSize: RasterSize;
  height: Float32Array | undefined;
  biomeOverride: Uint8Array | undefined;
  /** Incrémenté à chaque nouveau relief, pour que le rendu sache re-téléverser. */
  heightVersion: number;

  status: GenerationStatus;
  error: string | undefined;

  setTDays: (tDays: number) => void;
  setOmega: (ring: RingId, omegaDegPerDay: number) => void;
  setCut: (which: 'north' | 'south', lat: number) => void;
  setSeaLevel: (seaLevelM: number) => void;
  setShowFaults: (showFaults: boolean) => void;
  setBookStyle: (bookStyle: boolean) => void;
  setTerrain: (patch: Partial<TerrainParams>) => void;
  setPlaceDensity: (placeDensity: number) => void;
  setPlaces: (places: readonly Place[]) => void;
  setRoads: (roads: readonly Road[]) => void;
  /** Force le rendu à relire le relief après une édition. */
  bumpHeightVersion: () => void;
  /** Remplace l'état courant par un monde relu. */
  adopt: (doc: WorldDocument) => void;
  /** Instantané du monde, tel qu'il sera enregistré. */
  snapshot: () => WorldDocument | undefined;
  exportWorld: () => void;
  importWorld: (file: File) => Promise<void>;
  restoreFromStorage: () => Promise<boolean>;
  scheduleAutosave: () => void;
  regenerate: () => Promise<void>;
}

export const MAX_ALTITUDE = MAX_ALTITUDE_M;
export const MAX_DEPTH = MAX_DEPTH_M;

/**
 * État de l'application. Provisoire : à partir de la phase 4, toute écriture
 * sur le monde passera par une commande annulable de src/edit.
 * Voir docs/editeur.md.
 */
const autosave = createAutosave();

export const useWorldStore = create<WorldState>((set, get) => ({
  ringConfig: DEFAULT_RING_CONFIG,
  tDays: DEFAULT_SETTINGS.tDays,
  radiusKm: DEFAULT_SETTINGS.radiusKm,
  seaLevelM: DEFAULT_SETTINGS.seaLevelM,
  showFaults: true,
  bookStyle: true,

  worldId: 'monde-1',
  worldName: 'Pangée',
  fog: undefined,
  terrain: DEFAULT_TERRAIN_PARAMS,
  placeDensity: DEFAULT_PLACE_DENSITY,
  places: [],
  roads: [],
  rasterSize: RASTER_2K,
  height: undefined,
  biomeOverride: undefined,
  heightVersion: 0,

  status: 'idle',
  error: undefined,

  // Tous ces réglages font partie du document : les changer sans enregistrer
  // ferait perdre au MJ la configuration de son monde au rechargement.
  setTDays: (tDays) => {
    set({ tDays });
    get().scheduleAutosave();
  },

  setOmega: (ring, omegaDegPerDay) => {
    set((s) => ({
      ringConfig: {
        ...s.ringConfig,
        rings: { ...s.ringConfig.rings, [ring]: { id: ring, omegaDegPerDay } },
      },
    }));
    get().scheduleAutosave();
  },

  setCut: (which, lat) => {
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
    });
    get().scheduleAutosave();
  },

  setSeaLevel: (seaLevelM) => {
    set({ seaLevelM });
    get().scheduleAutosave();
  },
  setShowFaults: (showFaults) => set({ showFaults }),
  setBookStyle: (bookStyle) => set({ bookStyle }),
  setTerrain: (patch) => set((s) => ({ terrain: { ...s.terrain, ...patch } })),
  setPlaceDensity: (placeDensity) => set({ placeDensity }),
  setPlaces: (places) => set({ places }),
  setRoads: (roads) => set({ roads }),
  bumpHeightVersion: () => set((s) => ({ heightVersion: s.heightVersion + 1 })),

  snapshot: () => {
    const s = get();
    if (!s.height || !s.biomeOverride) return undefined;
    const fogSize = {
      width: Math.ceil(s.rasterSize.width / FOG_DOWNSCALE),
      height: Math.ceil(s.rasterSize.height / FOG_DOWNSCALE),
    };
    return {
      id: s.worldId,
      name: s.worldName,
      seed: s.terrain.seed,
      ringConfig: s.ringConfig,
      radiusKm: s.radiusKm,
      seaLevelM: s.seaLevelM,
      campaignDate: s.tDays,
      size: s.rasterSize,
      height: s.height,
      biomeOverride: s.biomeOverride,
      fogSize,
      fog: s.fog ?? new Uint8Array(fogSize.width * fogSize.height),
      places: s.places,
      roads: s.roads,
    };
  },

  exportWorld: () => {
    const doc = get().snapshot();
    if (!doc) {
      set({ error: "Il n'y a pas encore de monde à exporter." });
      return;
    }
    downloadWorld(doc);
  },

  importWorld: async (file) => {
    const parsed = await readWorldFile(file);
    if (!parsed.ok) {
      set({ error: parsed.error });
      return;
    }
    get().adopt(parsed.value);
  },

  restoreFromStorage: async () => {
    const parsed = await loadWorld(get().worldId);
    if (!parsed.ok) return false;
    get().adopt(parsed.value);
    return true;
  },

  adopt: (doc: WorldDocument) => {
    set((s) => ({
      worldId: doc.id,
      worldName: doc.name,
      ringConfig: doc.ringConfig,
      radiusKm: doc.radiusKm,
      seaLevelM: doc.seaLevelM,
      tDays: doc.campaignDate,
      rasterSize: doc.size,
      height: doc.height,
      biomeOverride: doc.biomeOverride,
      fog: doc.fog,
      places: doc.places,
      roads: doc.roads,
      terrain: { ...s.terrain, seed: doc.seed },
      heightVersion: s.heightVersion + 1,
      status: 'idle',
      error: undefined,
    }));
    void useHydroStore.getState().setHeight(doc.size, doc.height);
  },

  scheduleAutosave: () => {
    autosave.schedule(
      () => {
        const doc = get().snapshot();
        if (!doc) throw new Error('Aucun monde à enregistrer.');
        return doc;
      },
      (message) => set({ error: `Enregistrement impossible : ${message}` }),
    );
  },

  regenerate: async () => {
    const { rasterSize, terrain, placeDensity, seaLevelM, radiusKm, ringConfig } = get();
    set({ status: 'running', error: undefined });
    try {
      const result = await generateWorldInWorker({
        size: rasterSize,
        terrain,
        placeDensity,
        seaLevelM,
        radiusKm,
        ringConfig,
      });
      // Le worker hydrologique garde sa propre copie du relief : changer de
      // date ne lui renverra plus que quelques nombres.
      await useHydroStore.getState().setHeight(result.size, result.height);
      set((s) => ({
        height: result.height,
        biomeOverride: result.biomeOverride,
        places: result.places,
        rasterSize: result.size,
        heightVersion: s.heightVersion + 1,
        status: 'idle',
      }));
      get().scheduleAutosave();
    } catch (cause) {
      // Une erreur de worker doit atteindre l'interface, jamais mourir en
      // silence. Voir docs/conventions.md.
      set({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) });
    }
  },
}));

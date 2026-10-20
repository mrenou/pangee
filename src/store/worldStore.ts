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
import { createAutosave, downloadWorld, loadLastWorld, readWorldFile } from '@/store/persistence';
import type { WorldDocument } from '@/model/file';
import { fogSizeOf } from '@/model/world';

export type GenerationStatus = 'idle' | 'running' | 'error';

interface WorldState {
  ringConfig: RingConfig;
  tDays: number;
  radiusKm: number;
  seaLevelM: number;
  showFaults: boolean;
  bookStyle: boolean;
  /** Eau, volcans et créatures animés. Réglage d'affichage, non enregistré. */
  animate: boolean;
  /** Time-lapse en cours : la date avance d'elle-même. */
  playing: boolean;
  playSpeedDaysPerS: number;

  worldId: string;
  worldName: string;
  /** Brouillard de guerre, en référentiel local ; présent dès qu'il y a un monde. */
  fog: Uint8Array | undefined;
  fogSize: RasterSize;
  /** Incrémenté quand le brouillard change hors du pinceau : annulation, nouveau monde. */
  fogVersion: number;
  terrain: TerrainParams;
  placeDensity: number;
  places: readonly Place[];
  roads: readonly Road[];
  rasterSize: RasterSize;
  height: Float32Array | undefined;
  biomeOverride: Uint8Array | undefined;
  /**
   * Incrémenté à chaque nouveau monde et à chaque édition raster : le rendu
   * re-téléverse le relief, le worker hydrologique reçoit ses nouvelles couches.
   */
  heightVersion: number;

  status: GenerationStatus;
  error: string | undefined;

  setTDays: (tDays: number) => void;
  setOmega: (ring: RingId, omegaDegPerDay: number) => void;
  setCut: (which: 'north' | 'south', lat: number) => void;
  setSeaLevel: (seaLevelM: number) => void;
  setShowFaults: (showFaults: boolean) => void;
  setBookStyle: (bookStyle: boolean) => void;
  setAnimate: (animate: boolean) => void;
  setPlaying: (playing: boolean) => void;
  setPlaySpeed: (daysPerS: number) => void;
  setTerrain: (patch: Partial<TerrainParams>) => void;
  setPlaceDensity: (placeDensity: number) => void;
  setPlaces: (places: readonly Place[]) => void;
  setRoads: (roads: readonly Road[]) => void;
  /** Force le rendu à relire le relief après une édition. */
  bumpHeightVersion: () => void;
  bumpFogVersion: () => void;
  /** Remplace l'état courant par un monde relu. */
  adopt: (doc: WorldDocument) => void;
  /** Instantané du monde, tel qu'il sera enregistré. */
  snapshot: () => WorldDocument | undefined;
  exportWorld: () => void;
  /** Remplace le monde courant par un fichier ; `false` si la lecture a échoué. */
  importWorld: (file: File) => Promise<boolean>;
  restoreFromStorage: () => Promise<boolean>;
  scheduleAutosave: () => void;
  /** Façonne un monde neuf ; `false` si la génération a échoué. */
  regenerate: () => Promise<boolean>;
}

/** Dernière date proposée par le curseur ; au-delà, la lecture s'arrête. */
export const MAX_T_DAYS = 73_000;

/**
 * Pas du time-lapse. La date n'avance qu'une trentaine de fois par seconde :
 * chaque pas redessine symboles, routes et rivières, et le faire à chaque
 * image du navigateur saccadait la carte sans rien montrer de plus.
 */
const TIMELAPSE_STEP_MS = 33;

/**
 * Boucle du time-lapse : avance la date au rythme réglé, tant que la lecture
 * n'est pas interrompue. Le temps réel écoulé fait foi, pas le nombre
 * d'images : un onglet ralenti ne ralentit pas la campagne.
 */
function startTimelapse(get: () => WorldState, set: (partial: Partial<WorldState>) => void): void {
  let last = performance.now();
  let pending = 0;
  const step = (now: number): void => {
    const state = get();
    if (!state.playing) return;
    pending += now - last;
    last = now;
    if (pending >= TIMELAPSE_STEP_MS) {
      const next = Math.min(MAX_T_DAYS, state.tDays + (state.playSpeedDaysPerS * pending) / 1000);
      pending = 0;
      state.setTDays(next);
      if (next >= MAX_T_DAYS) {
        set({ playing: false });
        return;
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Les animations sont décoratives : on les coupe d'office pour qui a demandé
 * à son système de réduire les mouvements.
 */
function prefersMotion(): boolean {
  return (
    typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
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
  animate: prefersMotion(),
  playing: false,
  playSpeedDaysPerS: 30,

  worldId: 'monde-1',
  worldName: 'Pangée',
  fog: undefined,
  fogSize: fogSizeOf(RASTER_2K),
  fogVersion: 0,
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
  setAnimate: (animate) => set({ animate }),
  setPlaying: (playing) => {
    if (playing === get().playing) return;
    set({ playing });
    if (playing) startTimelapse(get, set);
  },
  setPlaySpeed: (playSpeedDaysPerS) => set({ playSpeedDaysPerS }),
  setTerrain: (patch) => set((s) => ({ terrain: { ...s.terrain, ...patch } })),
  setPlaceDensity: (placeDensity) => set({ placeDensity }),
  setPlaces: (places) => set({ places }),
  setRoads: (roads) => set({ roads }),
  bumpHeightVersion: () => set((s) => ({ heightVersion: s.heightVersion + 1 })),
  bumpFogVersion: () => set((s) => ({ fogVersion: s.fogVersion + 1 })),

  snapshot: () => {
    const s = get();
    if (!s.height || !s.biomeOverride) return undefined;
    const { fogSize } = s;
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
      return false;
    }
    get().adopt(parsed.value);
    // Sans enregistrement immédiat, le rechargement rouvrirait le monde
    // précédent tant que le MJ n'a rien édité dans celui-ci.
    get().scheduleAutosave();
    return true;
  },

  restoreFromStorage: async () => {
    const parsed = await loadLastWorld(get().worldId);
    if (!parsed.ok) return false;
    get().adopt(parsed.value);
    // Sans enregistrement immédiat, le rechargement rouvrirait le monde
    // précédent tant que le MJ n'a rien édité dans celui-ci.
    get().scheduleAutosave();
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
      fogSize: doc.fogSize,
      fogVersion: s.fogVersion + 1,
      places: doc.places,
      roads: doc.roads,
      terrain: { ...s.terrain, seed: doc.seed },
      heightVersion: s.heightVersion + 1,
      status: 'idle',
      error: undefined,
    }));
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
      set((s) => ({
        height: result.height,
        biomeOverride: result.biomeOverride,
        // Un monde neuf n'a encore rien montré aux joueurs.
        fog: new Uint8Array(fogSizeOf(result.size).width * fogSizeOf(result.size).height),
        fogSize: fogSizeOf(result.size),
        fogVersion: s.fogVersion + 1,
        places: result.places,
        rasterSize: result.size,
        heightVersion: s.heightVersion + 1,
        status: 'idle',
      }));
      get().scheduleAutosave();
      return true;
    } catch (cause) {
      // Une erreur de worker doit atteindre l'interface, jamais mourir en
      // silence. Voir docs/conventions.md.
      set({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) });
      return false;
    }
  },
}));

import { create } from 'zustand';
import { DEFAULT_RING_CONFIG, type RingConfig, type RingId } from '@/model/ring';
import { DEFAULT_SETTINGS } from '@/model/world';

interface WorldState {
  ringConfig: RingConfig;
  tDays: number;
  radiusKm: number;
  seaLevelM: number;
  setTDays: (tDays: number) => void;
  setOmega: (ring: RingId, omegaDegPerDay: number) => void;
}

/**
 * État de l'application. Provisoire : à partir de la phase 4, toute écriture
 * passera par une commande annulable de src/edit. Voir docs/editeur.md.
 */
export const useWorldStore = create<WorldState>((set) => ({
  ringConfig: DEFAULT_RING_CONFIG,
  tDays: DEFAULT_SETTINGS.tDays,
  radiusKm: DEFAULT_SETTINGS.radiusKm,
  seaLevelM: DEFAULT_SETTINGS.seaLevelM,

  setTDays: (tDays) => set({ tDays }),

  setOmega: (ring, omegaDegPerDay) =>
    set((s) => ({
      ringConfig: {
        ...s.ringConfig,
        rings: {
          ...s.ringConfig.rings,
          [ring]: { id: ring, omegaDegPerDay },
        },
      },
    })),
}));

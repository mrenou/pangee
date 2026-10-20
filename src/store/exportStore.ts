/**
 * Réglages de l'export PNG et lien vers le moteur de rendu.
 *
 * Le cadre est en référentiel monde : il désigne ce que le MJ voit à la date
 * courante, et c'est à cette date que l'image est rendue. Voir docs/partage.md.
 */

import { create } from 'zustand';
import type { WorldRect } from '@/model/viewport';

export interface ExportOptions {
  readonly widthPx: number;
  readonly applyFog: boolean;
  readonly showFaults: boolean;
  readonly title: string;
  readonly compass: boolean;
  readonly scale: boolean;
  readonly date: boolean;
  readonly border: boolean;
}

/**
 * Ce que le moteur de rendu offre à l'export. Le canvas l'enregistre à son
 * montage : le store ne connaît pas Pixi.
 */
export interface Exporter {
  readonly maxTextureSize: () => number;
  readonly exportPng: (rect: WorldRect, options: ExportOptions) => Promise<Blob>;
}

interface ExportState {
  rect: WorldRect | undefined;
  options: ExportOptions;
  running: boolean;
  error: string | undefined;
  exporter: Exporter | undefined;

  setRect: (rect: WorldRect | undefined) => void;
  setOptions: (patch: Partial<ExportOptions>) => void;
  setExporter: (exporter: Exporter | undefined) => void;
  /** Rend le cadre et renvoie l'image, ou `undefined` en cas d'échec (voir `error`). */
  render: () => Promise<Blob | undefined>;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  widthPx: 2400,
  applyFog: true,
  // Une carte pour les joueurs se passe volontiers du trait de faille.
  showFaults: false,
  title: '',
  compass: true,
  scale: true,
  date: true,
  border: true,
};

export const useExportStore = create<ExportState>((set, get) => ({
  rect: undefined,
  options: DEFAULT_EXPORT_OPTIONS,
  running: false,
  error: undefined,
  exporter: undefined,

  setRect: (rect) => set({ rect, error: undefined }),
  setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch }, error: undefined })),
  setExporter: (exporter) => set({ exporter }),

  render: async () => {
    const { rect, options, exporter } = get();
    if (!rect || !exporter) return undefined;
    set({ running: true, error: undefined });
    try {
      return await exporter.exportPng(rect, options);
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : String(cause) });
      return undefined;
    } finally {
      set({ running: false });
    }
  },
}));

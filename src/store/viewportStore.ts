import { create } from 'zustand';
import { normalizeViewport, type Viewport } from '@/model/viewport';

interface ViewportState {
  viewport: Viewport;
  setViewport: (viewport: Viewport) => void;
  resize: (widthPx: number, heightPx: number) => void;
}

const INITIAL: Viewport = {
  centerLonWorld: 0,
  centerLat: 0,
  pixelsPerDegree: 6,
  widthPx: 1280,
  heightPx: 720,
};

export const useViewportStore = create<ViewportState>((set) => ({
  viewport: INITIAL,
  setViewport: (viewport) => set({ viewport: normalizeViewport(viewport) }),
  resize: (widthPx, heightPx) =>
    set((s) => ({ viewport: normalizeViewport({ ...s.viewport, widthPx, heightPx }) })),
}));

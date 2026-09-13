import { MapCanvas } from '@/ui/MapCanvas';
import { GenerationPanel } from '@/ui/GenerationPanel';
import { RingPanel } from '@/ui/RingPanel';

export function App() {
  return (
    <div className="flex h-full w-full">
      <MapCanvas />
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-ink-soft/30 bg-parchment p-4">
        <h1 className="text-xl font-semibold">Pangée</h1>
        <p className="mt-1 text-xs text-ink-soft">
          Glisser pour déplacer la carte, molette pour zoomer.
        </p>
        <div className="mt-4">
          <RingPanel />
          <GenerationPanel />
        </div>
      </aside>
    </div>
  );
}

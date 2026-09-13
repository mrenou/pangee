import { MapCanvas } from '@/ui/MapCanvas';
import { RingPanel } from '@/ui/RingPanel';

export function App() {
  return (
    <div className="flex h-full w-full">
      <MapCanvas />
      <RingPanel />
    </div>
  );
}

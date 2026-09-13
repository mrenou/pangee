/**
 * Mesure du budget de l'étage hydrologique. Lancé à la main : `npm run bench`.
 * Budget visé : moins d'une seconde en 2048×1024. Voir docs/hydrologie.md.
 */

import { DEFAULT_TERRAIN_PARAMS, generateHeight } from '@/gen/terrain';
import { computeHydro, resetHydroBuffers } from '@/hydro';
import { RASTER_2K, RASTER_4K, type RasterSize } from '@/model/world';

function bench(label: string, size: RasterSize): void {
  resetHydroBuffers();

  const generationStart = performance.now();
  const heightWorld = generateHeight(size, DEFAULT_TERRAIN_PARAMS);
  const generationMs = performance.now() - generationStart;

  // Premier appel : il alloue les tampons. C'est le second qui reflète le coût
  // réel, puisque le worker les réutilise d'une date à l'autre.
  computeHydro({ size, heightWorld, seaLevelM: 0, rainPerCell: 1 });

  const started = performance.now();
  const state = computeHydro({ size, heightWorld, seaLevelM: 0, rainPerCell: 1 });
  const hydroMs = performance.now() - started;

  const cells = size.width * size.height;
  console.log(
    `${label} (${cells.toLocaleString('fr-FR')} cellules) : ` +
      `génération ${generationMs.toFixed(0)} ms, hydrologie ${hydroMs.toFixed(0)} ms, ` +
      `${state.lakes.length} lacs`,
  );
}

bench('2048 × 1024', RASTER_2K);
if (process.argv.includes('--4k')) bench('4096 × 2048', RASTER_4K);

/**
 * Client du worker hydrologique.
 *
 * Les demandes sont sérialisées : pendant qu'un calcul tourne, seule la
 * dernière demande reçue est retenue. Le curseur de date peut donc bouger
 * librement sans empiler une seconde de calcul par image.
 * Voir docs/temps.md.
 */

import * as Comlink from 'comlink';
import type { HydroApi, HydroReply, HydroRequest } from '@/workers/hydro.worker';
import type { RasterSize } from '@/model/world';

let worker: Worker | undefined;
let api: Comlink.Remote<HydroApi> | undefined;

let running = false;
let pending: HydroRequest | undefined;

function ensureWorker(): Comlink.Remote<HydroApi> {
  if (!api) {
    worker = new Worker(new URL('@/workers/hydro.worker.ts', import.meta.url), { type: 'module' });
    api = Comlink.wrap<HydroApi>(worker);
  }
  return api;
}

/**
 * Transmet une copie des couches locales : les tampons d'origine restent
 * utilisables ici, et le pinceau peut continuer d'y écrire.
 */
export async function sendLayersToHydro(
  size: RasterSize,
  height: Float32Array,
  biomeOverride: Uint8Array,
): Promise<void> {
  const heightCopy = new Float32Array(height);
  const overrideCopy = new Uint8Array(biomeOverride);
  await ensureWorker().setLayers(
    size,
    Comlink.transfer(heightCopy, [heightCopy.buffer]),
    Comlink.transfer(overrideCopy, [overrideCopy.buffer]),
  );
}

/**
 * Demande un calcul. Si un calcul est déjà en cours, la demande remplace celle
 * qui attendait : on ne calcule jamais un état que personne n'attend plus.
 */
export async function requestHydro(
  request: HydroRequest,
  onReply: (reply: HydroReply) => void,
  onError: (message: string) => void,
): Promise<void> {
  pending = request;
  if (running) return;

  running = true;
  try {
    while (pending) {
      const next = pending;
      pending = undefined;
      const reply = await ensureWorker().compute(next);
      onReply(reply);
    }
  } catch (cause) {
    onError(cause instanceof Error ? cause.message : String(cause));
  } finally {
    running = false;
  }
}

export function disposeHydroWorker(): void {
  worker?.terminate();
  worker = undefined;
  api = undefined;
  running = false;
  pending = undefined;
}

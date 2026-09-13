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

/** Transmet une copie du relief : le tampon d'origine reste utilisable ici. */
export async function sendHeightToHydro(size: RasterSize, height: Float32Array): Promise<void> {
  await ensureWorker().setHeight(size, new Float32Array(height));
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

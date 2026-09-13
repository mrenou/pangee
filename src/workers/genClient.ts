/**
 * Client du worker de génération.
 *
 * Une seule instance de worker est réutilisée : le démarrer coûte plus cher
 * qu'une génération sur une petite grille. Toute erreur du worker est remontée
 * telle quelle à l'appelant, jamais avalée. Voir docs/conventions.md.
 */

import * as Comlink from 'comlink';
import type { GenerateWorldRequest, GenerateWorldResult } from '@/gen';
import type { GenApi } from '@/workers/gen.worker';

let worker: Worker | undefined;
let api: Comlink.Remote<GenApi> | undefined;

function ensureWorker(): Comlink.Remote<GenApi> {
  if (!api) {
    worker = new Worker(new URL('@/workers/gen.worker.ts', import.meta.url), { type: 'module' });
    api = Comlink.wrap<GenApi>(worker);
  }
  return api;
}

export async function generateWorldInWorker(
  request: GenerateWorldRequest,
): Promise<GenerateWorldResult> {
  return ensureWorker().generateWorld(request);
}

/** Libère le worker. Utile au démontage et aux tests. */
export function disposeGenWorker(): void {
  worker?.terminate();
  worker = undefined;
  api = undefined;
}

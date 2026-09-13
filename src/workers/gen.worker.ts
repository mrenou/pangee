/**
 * Worker de génération procédurale.
 * Ne contient que la plomberie Comlink : la logique est dans src/gen.
 * Voir docs/architecture.md.
 */

import * as Comlink from 'comlink';
import { generateWorld, type GenerateWorldRequest, type GenerateWorldResult } from '@/gen';

const api = {
  generateWorld(request: GenerateWorldRequest): GenerateWorldResult {
    const result = generateWorld(request);
    // Transfert sans copie : les tampons quittent le worker.
    return Comlink.transfer(result, [result.height.buffer, result.biomeOverride.buffer]);
  },
};

export type GenApi = typeof api;

Comlink.expose(api);

/**
 * Persistance locale : autosave en IndexedDB, export et import de fichiers.
 *
 * Aucun serveur n'est impliqué : le monde vit dans le navigateur du MJ et dans
 * les fichiers qu'il exporte. Voir docs/fichier-pangee.md.
 */

import { del, get, keys, set } from 'idb-keyval';
import { parseWorld, serializeWorld, type Result, type WorldDocument } from '@/model/file';

const PREFIX = 'pangee:world:';
/** Identifiant du dernier monde enregistré, rouvert au chargement de la page. */
const LAST_KEY = 'pangee:last-world';

/** Délai d'inactivité avant d'écrire sur le disque. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

export interface StoredWorld {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly bytes: number;
}

function keyOf(id: string): string {
  return `${PREFIX}${id}`;
}

/** Écrit le monde dans IndexedDB, sous sa forme de fichier. */
export async function saveWorld(doc: WorldDocument): Promise<void> {
  await set(keyOf(doc.id), serializeWorld(doc));
  await set(LAST_KEY, doc.id);
}

/** Dernier monde enregistré, ou celui de l'identifiant donné à défaut. */
export async function loadLastWorld(fallbackId: string): Promise<Result<WorldDocument>> {
  const last = await get<string>(LAST_KEY);
  return loadWorld(last ?? fallbackId);
}

export async function loadWorld(id: string): Promise<Result<WorldDocument>> {
  const bytes = await get<Uint8Array>(keyOf(id));
  if (!bytes) return { ok: false, error: `Aucun monde enregistré sous l'identifiant ${id}.` };
  return parseWorld(bytes);
}

export async function deleteWorld(id: string): Promise<void> {
  await del(keyOf(id));
}

/** Liste les mondes enregistrés, sans les décoder entièrement. */
export async function listWorlds(): Promise<readonly StoredWorld[]> {
  const all = await keys();
  const ids = all
    .filter((key): key is string => typeof key === 'string' && key.startsWith(PREFIX))
    .map((key) => key.slice(PREFIX.length));

  const worlds: StoredWorld[] = [];
  for (const id of ids) {
    const bytes = await get<Uint8Array>(keyOf(id));
    if (!bytes) continue;
    const parsed = parseWorld(bytes);
    if (!parsed.ok) continue;
    worlds.push({
      id,
      name: parsed.value.name,
      updatedAt: parsed.value.createdAt ?? '',
      bytes: bytes.byteLength,
    });
  }
  return worlds;
}

/**
 * Autosave à écriture différée.
 *
 * Le MJ peint en continu : écrire à chaque coup de pinceau saturerait le
 * disque. On n'écrit qu'après un temps d'arrêt, et une écriture en cours
 * n'empêche pas d'en programmer une nouvelle.
 */
export function createAutosave(delayMs = AUTOSAVE_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => WorldDocument) | undefined;

  return {
    schedule(snapshot: () => WorldDocument, onError?: (message: string) => void): void {
      pending = snapshot;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const take = pending;
        pending = undefined;
        if (!take) return;
        void saveWorld(take()).catch((cause: unknown) => {
          onError?.(cause instanceof Error ? cause.message : String(cause));
        });
      }, delayMs);
    },
    cancel(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

/** Propose le fichier au téléchargement. Purement client, aucun envoi réseau. */
export function downloadWorld(doc: WorldDocument): void {
  const blob = new Blob([serializeWorld(doc) as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${doc.name || 'pangee'}.pangee`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readWorldFile(file: File): Promise<Result<WorldDocument>> {
  const buffer = await file.arrayBuffer();
  return parseWorld(new Uint8Array(buffer));
}

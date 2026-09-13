/**
 * Aléa déterministe de la génération.
 *
 * Aucun appel à Math.random dans src/gen : une seed et des paramètres
 * déterminent le monde cellule par cellule. Chaque domaine reçoit une
 * sous-seed dérivée, pour qu'un changement de densité de villes ne rejoue pas
 * le relief. Voir docs/generation.md.
 */

export type GenDomain = 'relief' | 'climate' | 'places' | 'roads' | 'names';

/** Générateur pseudo-aléatoire uniforme sur [0, 1[. */
export type Rng = () => number;

/**
 * FNV-1a 32 bits sur `${seed}:${domain}`.
 * Deux domaines d'une même seed donnent deux états sans corrélation visible.
 */
export function hashSeed(seed: string | number, domain: GenDomain): number {
  const text = `${String(seed)}:${domain}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // hash *= 16777619, en arithmétique 32 bits sans dépassement de précision.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** PRNG 32 bits rapide et sans état externe (Tommy Ettinger, mulberry32). */
export function mulberry32(state: number): Rng {
  let s = state >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Raccourci : le générateur d'un domaine pour une seed donnée. */
export function rngFor(seed: string | number, domain: GenDomain): Rng {
  return mulberry32(hashSeed(seed, domain));
}

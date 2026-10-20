/**
 * Générateur de toponymes.
 *
 * Chaînes de Markov d'ordre 2 sur les lettres, apprises depuis un corpus par
 * culture. Trois cultures, par bande de latitude : les noms du nord, des
 * tropiques et du sud ne sonnent pas pareil, ce qui rend le cisaillement des
 * anneaux lisible dans la toponymie elle-même. Les cultures suivent la
 * latitude d'avant le Cataclysme, pas le découpage en anneaux, que le MJ peut
 * changer à tout moment. Voir docs/generation.md.
 */

/** Culture toponymique d'une bande de latitude. */
export type NameCulture = 'north' | 'equator' | 'south';

/** Latitude au-delà de laquelle on change de culture, de part et d'autre de l'équateur. */
const CULTURE_EDGE_LAT = 30;

/** Culture d'une latitude : le nord au-delà de 30°, le sud en deçà de −30°. */
export function cultureOfLat(latDeg: number): NameCulture {
  if (latDeg > CULTURE_EDGE_LAT) return 'north';
  if (latDeg < -CULTURE_EDGE_LAT) return 'south';
  return 'equator';
}
import { mulberry32, type Rng } from '@/gen/rng';

/**
 * Marqueur de début et de fin de mot. N'importe quel caractère absent des
 * corpus ferait l'affaire ; celui-ci a l'avantage d'être lisible en débogage.
 */
const EDGE = '^';

const ORDER = 2;

/**
 * Corpus d'amorce, inventés pour le monde. Ils ne servent pas de dictionnaire :
 * le générateur n'en ressort presque jamais un nom tel quel, il en apprend les
 * enchaînements de lettres.
 */
const CORPUS: Readonly<Record<NameCulture, readonly string[]>> = {
  north: [
    'Vorngard',
    'Skaldheim',
    'Hjalmar',
    'Draugfell',
    'Ysmark',
    'Thornbrekk',
    'Kaldvik',
    'Ulfstad',
    'Bergholm',
    'Grimsund',
    'Norrhavn',
    'Frosthjem',
    'Eiravik',
    'Sturmgard',
    'Valdheim',
    'Rimfjell',
    'Askrholt',
    'Jotunmark',
    'Halvard',
    'Snorrheim',
    'Fenrivik',
    'Isgard',
    'Myrkdal',
    'Brannfell',
  ],
  equator: [
    'Aventhis',
    'Corella',
    'Marendol',
    'Thalassia',
    'Veridane',
    'Ostiane',
    'Calvarre',
    'Lumendis',
    'Sorentia',
    'Meridan',
    'Auriflor',
    'Pellagos',
    'Vestrella',
    'Cantarel',
    'Solivane',
    'Terrandes',
    'Ambrelis',
    'Novara',
    'Cirendil',
    'Palatine',
    'Ferralis',
    'Ombrelune',
    'Sarantis',
    'Valmiere',
  ],
  south: [
    'Saimara',
    'Belenoa',
    'Ithaqua',
    'Nyarela',
    'Qadesh',
    'Zanubara',
    'Tamaris',
    'Oleandra',
    'Kishara',
    'Mbanoa',
    'Selione',
    'Ahmara',
    'Verdanaya',
    'Loriane',
    'Tsavira',
    'Anouke',
    'Khalimar',
    'Ysandre',
    'Numiera',
    'Ozanne',
    'Jaharis',
    'Elimara',
    'Sombrana',
    'Wanaka',
  ],
};

type Chain = ReadonlyMap<string, readonly string[]>;

function buildChain(words: readonly string[]): Chain {
  const chain = new Map<string, string[]>();

  for (const word of words) {
    const padded = EDGE.repeat(ORDER) + word.toLowerCase() + EDGE;
    for (let i = ORDER; i < padded.length; i += 1) {
      const key = padded.slice(i - ORDER, i);
      const next = padded[i]!;
      const list = chain.get(key);
      if (list) list.push(next);
      else chain.set(key, [next]);
    }
  }

  return chain;
}

const CHAINS: Readonly<Record<NameCulture, Chain>> = {
  north: buildChain(CORPUS.north),
  equator: buildChain(CORPUS.equator),
  south: buildChain(CORPUS.south),
};

const MIN_LENGTH = 4;
const MAX_LENGTH = 13;

/** Une tentative de génération. Peut échouer, d'où les essais successifs. */
function attempt(chain: Chain, rng: Rng): string | undefined {
  let key = EDGE.repeat(ORDER);
  let word = '';

  for (let i = 0; i < MAX_LENGTH + 1; i += 1) {
    const options = chain.get(key);
    if (!options || options.length === 0) return undefined;

    const next = options[Math.floor(rng() * options.length)]!;
    if (next === EDGE) break;

    word += next;
    key = (key + next).slice(-ORDER);
  }

  if (word.length < MIN_LENGTH || word.length > MAX_LENGTH) return undefined;
  return word;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Un nom de cette culture, tiré de ce générateur.
 * Après plusieurs essais infructueux, on retombe sur un nom du corpus plutôt
 * que de renvoyer une chaîne vide.
 */
export function generateName(culture: NameCulture, rng: Rng): string {
  const chain = CHAINS[culture];
  for (let tries = 0; tries < 24; tries += 1) {
    const word = attempt(chain, rng);
    if (word) return capitalize(word);
  }
  const fallback = CORPUS[culture];
  return fallback[Math.floor(rng() * fallback.length)]!;
}

/**
 * Générateur de noms attaché à une graine.
 * Chaque lieu tire depuis un générateur dérivé de son propre identifiant, ce
 * qui rend un renommage individuel stable et réutilisable par l'éditeur.
 */
export function nameForPlace(culture: NameCulture, seedHash: number): string {
  return generateName(culture, mulberry32(seedHash));
}

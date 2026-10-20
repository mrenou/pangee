# Génération procédurale

Le monde de départ est produit par `src/gen/`, exécuté dans un Web Worker et piloté par une seed unique. Sortie : le raster `height` en référentiel local, plus les `Place` et `Road` initiaux. Tout le reste est dérivé ([hydrologie](hydrologie.md), climat, biomes).

## Principe

- Une seed (chaîne ou entier) plus un jeu de paramètres déterminent entièrement le monde : mêmes entrées, même planète, cellule par cellule.
- La génération écrit uniquement en **référentiel local**, c'est-à-dire le monde tel qu'avant le Cataclysme, anneaux alignés, à `t0`. Le découpage en anneaux n'intervient jamais ici : il n'apparaît qu'au rendu et dans les couches dérivées (voir [le modèle du monde](modele-monde.md) et [le temps](temps.md)).
- Le MJ régénère librement tant qu'il n'a pas édité. Dès qu'une commande d'édition a été appliquée ([éditeur](editeur.md)), la régénération affiche un avertissement explicite : elle écrase `height`, `biomeOverride`, les lieux et les routes.
- `biomeOverride` est rempli à 0 partout : la génération ne force aucun biome, elle produit du relief.

## Paramètres exposés

| Paramètre        | Type               | Défaut             | Effet                                                                  |
| ---------------- | ------------------ | ------------------ | ---------------------------------------------------------------------- |
| `seed`           | `string \| number` | tirée au lancement | Détermine tout ; affichée et copiable dans l'UI                        |
| `continentCount` | `number` (2–8)     | 4                  | Fréquence du masque continental                                        |
| `continentSize`  | `number` (0–1)     | 0.5                | Seuil du masque : part de terres émergées                              |
| `roughness`      | `number` (0–1)     | 0.5                | Persistance du fBm de détail ; côtes et crêtes plus ou moins découpées |
| `seaLevel`       | `number` (m)       | 0                  | Niveau de la mer ; modifiable ensuite sans régénérer                   |
| `placeDensity`   | `number` (0–1)     | 0.5                | Cible de lieux, de ~50 à ~150                                          |

`seaLevel` n'est pas cuit dans `height` : il reste un paramètre du monde, relu par l'hydrologie à chaque date.

## Déterminisme

Aucun appel à `Math.random` dans `src/gen/`. Un PRNG explicite est semé depuis la seed, et chaque domaine reçoit une **sous-seed dérivée** pour qu'un changement de `placeDensity` ne rejoue pas le relief :

```ts
type GenDomain = 'relief' | 'places' | 'roads' | 'names';

function hashSeed(seed: string | number, domain: GenDomain): number; // FNV-1a sur `${seed}:${domain}`
function mulberry32(state: number): () => number; // PRNG 32 bits, rapide, sans dépendance

const rngRelief = mulberry32(hashSeed(seed, 'relief'));
const rngPlaces = mulberry32(hashSeed(seed, 'places'));
```

Le bruit simplex reçoit lui aussi sa source d'aléa depuis `rngRelief`. Conséquence utile pour les tests ([conventions](conventions.md)) : une grille 64×32 générée avec une seed fixe donne un hash stable, vérifiable en Vitest.

## Bruit et wrap est-ouest

La planète est un cylindre : `lon ∈ [−180, 180[` avec wrap. Un bruit 2D échantillonné en `(x, y)` produirait une couture visible au méridien ±180. On échantillonne donc un **bruit 3D sur un cercle** : la longitude devient un angle, le cylindre se referme sur lui-même, et la couture disparaît par construction.

```ts
function sampleCylinder(noise3D: Noise3D, lonDeg: number, latDeg: number, f: number): number {
  const theta = (lonDeg * Math.PI) / 180;
  return noise3D(Math.cos(theta) * f, Math.sin(theta) * f, (latDeg / 90) * f * LAT_SCALE);
}
```

Le fBm empile les octaves par-dessus cet échantillonnage :

```ts
interface FbmParams {
  octaves: number;
  frequency: number;
  lacunarity: number;
  persistence: number;
}
// défaut relief : { octaves: 7, frequency: 1.6, lacunarity: 2.0, persistence: 0.45 + 0.25 * roughness }
```

**Atténuation polaire** : au-delà de |lat| ≈ 70°, les cellules d'une même ligne couvrent une distance réelle minuscule et le détail haute fréquence devient du bruit illisible. Un facteur `1 − smoothstep(70, 88, |lat|)` réduit progressivement l'amplitude du détail et tire le masque continental vers l'océan, ce qui donne des calottes plutôt que des artefacts convergents.

## Formation des continents

1. **Masque continental** : fBm basse fréquence (3 octaves, fréquence ∝ `continentCount`) avec _domain warping_ léger pour casser la rondeur des taches. Seuil piloté par `continentSize`.
2. **Détail** : fBm haute fréquence (7 octaves) modulé par `roughness`, ajouté avec un poids d'environ 0.3, lui-même masqué par le masque continental pour que l'océan reste lisse.
3. **Redistribution** : la somme brute est ramenée dans `[−1, 1]` puis passée dans une courbe puissance, séparément pour les terres et pour les fonds marins :

```ts
const e = continental * 0.7 + detail * 0.3; // ∈ [-1, 1]
const height =
  e >= 0
    ? Math.pow(e, LAND_EXP) * MAX_ALTITUDE // LAND_EXP ≈ 2.2
    : -Math.pow(-e, OCEAN_EXP) * MAX_DEPTH; // OCEAN_EXP ≈ 1.4
```

Un exposant terrestre > 1 écrase les valeurs médianes : on obtient de larges plaines côtières et des plateaux, les sommets restant rares. Un exposant océanique plus faible donne un plateau continental court puis des grands fonds. Valeurs indicatives : `MAX_ALTITUDE` 6000 m, `MAX_DEPTH` 8000 m.

## Climat et biomes

La génération ne produit pas de biomes. Elle produit `height` et laisse `biomeOverride` à 0. Les biomes sont **dérivés en référentiel monde** à chaque date : température issue de la latitude et de l'altitude, humidité issue de la distance à l'eau douce et à la mer plus un bruit, override du MJ prioritaire. Le détail des seuils et la table des biomes sont dans [hydrologie](hydrologie.md).

## Placement des lieux

Cible : `50 + placeDensity * 100` lieux, arrondie, avec tolérance si les critères ne sont pas satisfaits.

1. Une passe d'hydrologie est lancée à `t0` pour disposer de `flowAcc` et `waterLevel` — sans eau douce, aucun critère de ville n'a de sens.
2. Score par cellule, nul si disqualifiant :
   - altitude entre `seaLevel + 5 m` et ~2200 m ;
   - `flowAcc` au-dessus du seuil rivière dans un rayon court, ou bord de lac, ou côte ;
   - biome habitable (pas de glace, pas de désert extrême, pas de haute montagne) ;
   - bonus pour pente faible et pour confluence (deux flux amont notables).
3. **Échantillonnage type Poisson** : les candidats sont tirés par ordre de score décroissant avec bruit déterministe, et rejetés si un lieu déjà posé se trouve à moins de `minDistanceKm`. La distance est calculée sur le cylindre, avec wrap en longitude et correction `cos(lat)` sur l'écart de longitude. `minDistanceKm` décroît avec `placeDensity` (~450 km à 50 lieux, ~180 km à 150).
4. **Type et taille** : le score normalisé détermine `size` (1 à 4), et `kind` en découle avec un tirage pondéré — `city` pour les meilleurs scores, puis `town`, `village`. Une fraction fixe est réservée à `fortress` (cols et détroits, pente forte à proximité), `ruin` (score moyen, loin des autres lieux), `volcano` (altitude élevée et gradient local fort), `landmark` (extrema de relief isolés).
5. `ringId` est calculé par `ringOf(lat)` à la pose, une fois pour toutes ; un lieu appartient à un seul anneau.

## Routes

> **État** : le placement des lieux et le générateur de noms sont en place ; le réseau routier
> décrit ci-dessous ne l'est pas encore. L'A* existe déjà (`src/gen/roadPath.ts`) et sert l'option
> « suivre le relief » de l'outil route ; il ne tient compte ni des biomes ni de la profondeur.

Pour chaque paire de lieux dont la distance est inférieure à un seuil (fonction de la somme des `size`), un A* est lancé sur la grille :

```
coût(a → b) = distance(a, b) * (1 + SLOPE_W * pente(a, b)² + BIOME_W * friction(biome(b)))
            + (b sous l'eau ? WATER_W * profondeur : 0)
```

Le graphe est ensuite élagué : on ne garde que les arêtes qui ne sont pas doublées par un chemin sensiblement plus court passant par un tiers lieu, ce qui donne un réseau ramifié plutôt qu'un maillage complet. Le `kind` dépend des `size` reliées : `road` entre deux lieux importants, `path` sinon, `sea-route` quand le trajet le moins coûteux est maritime.

**Règle des coupures** : une route qui traverse `cutNorthLat` ou `cutSouthLat` est **scindée à la création** en deux `Road`, une par anneau, chacune avec son propre `ringId`. À t ≠ `t0` les deux moitiés divergent : c'est le comportement voulu, la route est coupée par le Cataclysme. Détails dans [le modèle du monde](modele-monde.md).

## Générateur de noms

Chaînes de Markov d'ordre 2 sur des corpus de syllabes, un corpus par culture ou par région, plus un fallback syllabaire pour les corpus courts. La seed vient de `hashSeed(seed, 'names')`, et chaque lieu tire depuis un PRNG dérivé de son propre `id`, ce qui rend un renommage individuel stable. Les cultures peuvent être attribuées par anneau pour que les toponymes du nord, de l'équateur et du sud sonnent différemment. Le générateur est réutilisé par l'éditeur pour le bouton « autre nom ».

## Budget

La génération tourne dans un Web Worker via Comlink ([architecture](architecture.md)), l'UI reste réactive et affiche une progression par étape (relief, hydrologie d'amorçage, lieux, routes, noms). Cible : quelques secondes en 2048×1024, le fBm à 7 octaves sur 2 M de cellules dominant le coût. Les rasters reviennent en transferables, jamais copiés.

## Points ouverts

- **Tectonique de plaques** : générer des plaques, des frontières convergentes et divergentes pour obtenir des chaînes de montagnes orientées plutôt que des taches de bruit. Reporté en phase 7.
- **Érosion hydraulique** à la génération (incision fluviale, dépôt de sédiments) : rendrait les vallées plausibles, mais coûte cher en JS. Phase 7, éventuellement en WASM.
- Pluie climatique (moussons, ombres pluviométriques) au lieu d'une pluie uniforme — voir [décisions](decisions.md).

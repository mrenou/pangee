# Pangée — Plan d'implémentation

## 1. Vision

Outil web (navigateur, sans backend) destiné au MJ : visualiser, éditer et partager la carte d'un monde médiéval-fantastique dont la surface est découpée en trois anneaux tournant à des vitesses et dans des sens différents. Le MJ règle les anneaux, fixe la date de campagne, sculpte le monde (relief, biomes, villes, routes) et exporte des morceaux de carte (PNG, brouillard de guerre) pour ses joueurs. Le relief et la bathymétrie pilotent une hydrologie recalculée à chaque date : quand un anneau tourne, les rivières se bloquent, des lacs se forment, des plaines s'inondent.

## 2. Décisions de cadrage

| Sujet | Décision |
|---|---|
| Carte de base | Génération procédurale (seed), puis édition complète par le MJ |
| Vue | Carte 2D plate, projection équirectangulaire, wrap est-ouest infini, zoom continu |
| Anneaux | 3 anneaux (nord / équateur / sud), deux latitudes de coupure réglables, frontières nettes ; vitesse et sens réglables par anneau, du quasi-immobile au très rapide |
| Temps | Date de campagne fixée par le MJ (jours depuis le Cataclysme) ; position des anneaux déterministe = f(date) ; mode lecture (time-lapse) pour visualiser |
| Relief | Altitude et profondeur en mètres (bathymétrie incluse), niveau de la mer réglable |
| Hydrologie | Statique, recalculée à chaque date (v1) ; architecture prête pour une version volumétrique (v2) |
| Édition | Pinceau relief, pinceau biomes, lieux nommés, routes tracées à la main |
| Partage | Export PNG d'une zone ; brouillard de guerre appliqué à l'export |
| Animations | Eau, volcans, créatures — après le cœur fonctionnel |
| Échelle | ~50–150 villes, relief 2048×1024 (option 4096×2048) |
| Hébergement | Site statique (GitHub Pages / Cloudflare Pages), sauvegarde locale + fichier |

## 3. Modèle du monde

### 3.1 Coordonnées et référentiel

- La planète est traitée comme un cylindre : longitude ∈ [−180, 180[ avec wrap, latitude ∈ [−90, 90].
- Rayon R configurable (défaut 6371 km), utilisé pour convertir °/jour ↔ km/jour.
- **Référentiel canonique = « local à l'anneau »** : le monde est stocké tel qu'il était *avant* le Cataclysme (anneaux alignés, date t0). Tout ce que le MJ édite (relief, biomes, lieux, routes, brouillard) est stocké dans ce référentiel.
- Position affichée à la date t : `lon_monde = lon_local + Δλ_r(t)` avec `Δλ_r(t) = ω_r · (t − t0)` modulo 360, ω_r en °/jour, signé.
- Conséquences : revenir à t = t0 montre le monde d'avant le Cataclysme ; changer la vitesse d'un anneau ne casse aucune donnée (seule la fonction du temps change) ; les joueurs revoient exactement le même état pour une même date.

### 3.2 Anneaux

```ts
type RingId = 'north' | 'equator' | 'south';

interface Ring {
  id: RingId;
  omegaDegPerDay: number; // signé ; 0 = immobile
}

interface RingConfig {
  cutNorthLat: number; // ex. +30
  cutSouthLat: number; // ex. −30 ; invariant : cutSouthLat < cutNorthLat
  rings: Record<RingId, Ring>;
  t0: number;          // date d'alignement, défaut 0 = Cataclysme
}
```

- `ringOf(lat)` : nord si `lat > cutNorthLat`, sud si `lat < cutSouthLat`, sinon équateur.
- UI : vitesse affichée en km/jour à la latitude médiane de l'anneau et en °/jour, sens ±, préréglage « immobile ».

### 3.3 Couches raster (référentiel local, pleine planète)

| Couche | Type | Rôle |
|---|---|---|
| `height` | Float32 (m) | Altitude et profondeur. Négatif = sous le niveau de la mer par défaut |
| `biomeOverride` | Uint8 | 0 = automatique, sinon biome forcé par le MJ |
| `urban` (v1.1) | Uint8 | Emprise des villes ; permet une ville « coupée en deux » par une frontière |
| `fog` | Uint8, basse résolution | Zones révélées aux joueurs |

Résolution de base 2048×1024 (2 M cellules) ; 4096×2048 en option. Le rendu ajoute du micro-détail procédural au zoom (bruit dans le shader) pour ne pas dépendre de la résolution brute.

### 3.4 Objets vectoriels (référentiel local)

```ts
interface Place {
  id: string; ringId: RingId; lon: number; lat: number;
  name: string;
  kind: 'city' | 'town' | 'village' | 'ruin' | 'fortress' | 'volcano' | 'landmark';
  size: 1 | 2 | 3 | 4;
  notes?: string;
}

interface Road {
  id: string; ringId: RingId;
  points: [lon: number, lat: number][];
  kind: 'road' | 'path' | 'sea-route';
}
```

- Une route qui traverse une frontière d'anneau est **scindée à la création** en deux `Road` (un par anneau). À t ≠ t0 les deux moitiés divergent : c'est le comportement voulu (route coupée).
- Un lieu appartient à un seul anneau. Une ville « à cheval » = emprise `urban` peinte des deux côtés + un lieu par côté (ex. « Haute-Kerth » / « Basse-Kerth »).

### 3.5 Couches dérivées (référentiel monde, recalculées pour la date t)

1. **Assemblage** : pour chaque ligne y, anneau r = `ringOf(lat(y))`, décalage en x de `Δλ_r(t)` arrondi à la cellule → `heightWorld`.
2. **Hydrologie** (§4) → `waterLevel`, `flowAcc`, `flowDir`, `lakeId`, événements (cascades, falaises de faille).
3. **Climat et biomes** → `biome` : température par latitude et altitude, humidité par distance à l'eau + bruit, override MJ prioritaire.

## 4. Hydrologie

### 4.1 v1 — statique, déterministe

Entrée : `heightWorld`, `seaLevel`, pluie (uniforme en v1, climatique en v1.1). Sortie : `HydroState`.

1. **Océan** : composantes connexes de `h < seaLevel` ; la plus grande (et celles dont la surface dépasse un seuil) sont des mers. Les autres cuvettes seront traitées comme des lacs.
2. **Remplissage des dépressions** par *priority-flood* (Barnes et al., 2014), amorcé par les cellules océaniques au niveau `seaLevel`, avec wrap horizontal. Donne `filled[c] ≥ h[c]` : le niveau d'eau de chaque cuvette est la hauteur de son point de débordement.
3. **Directions d'écoulement** (D8) sur la surface `filled` ; les zones plates sont résolues par l'ordre de sortie de la file de priorité, qui fournit aussi un tri topologique.
4. **Accumulation** : somme de la pluie amont dans l'ordre topologique → `flowAcc`. Rivière si `flowAcc > seuil` (dépend de la résolution) ; largeur ∝ √acc.
5. **Lacs** : composantes de `filled > h + ε` hors océan ; pour chaque lac : niveau, surface, exutoire, débit entrant.
6. **Événements de frontière** : écoulement franchissant une latitude de coupure avec une chute > seuil → cascade ; `|Δh|` entre deux lignes adjacentes de part et d'autre d'une coupure > seuil → falaise de faille (escarpement).

Comportement obtenu sans logique spéciale : une rivière dont l'aval est bloqué par le décalage d'un anneau remplit sa cuvette jusqu'au nouveau point de débordement → lac + nouvel exutoire, ou inondation d'une plaine. Le MJ voit immédiatement ce qui est sous l'eau à la date t.

Coût estimé : 2 M cellules, tas binaire sur typed arrays → 0,3–0,6 s en JS dans un Web Worker. Debounce de 150 ms sur date/relief ; le terrain se décale instantanément, la couche eau se met à jour juste après. Passage en WASM (Rust) en réserve (phase 7).

### 4.2 v2 — volumétrique (prévue, hors v1)

Même entrée + `HydroState` précédent + Δt jours. Par lac : volume, courbe hauteur/volume (hypsométrie du bassin), entrées = acc × pluie, sorties = débordement à l'exutoire + évaporation. Permet « le lac met trois mois à se former » et l'assèchement. La signature `computeHydro(input, prev?)` est fixée dès la v1 pour que le rendu ne change pas.

## 5. Rendu

### 5.1 Pile

- **PixiJS v8** (WebGL2 / WebGPU) : scène 2D, sprites instanciés, texte, filtres.
- Couche terrain = un quad plein écran avec **shader personnalisé** échantillonnant `height` (texture locale, wrap REPEAT en x, décalage par anneau passé en uniformes), `waterLevel` / `flowAcc` / `flowDir` (textures monde) et `biome`. Le décalage d'anneau est exact (flottant) dans le shader : aucun assemblage CPU pour l'affichage.
- Caméra : pan/zoom continus, wrap infini est-ouest, clamp nord-sud. Molette, drag, pinch.

### 5.2 Style « carte de livre »

- Fond parchemin (texture + grain + vignette), couleurs désaturées par biome, ombrage de relief léger.
- Côtes : trait d'encre + hachures de rivage dans le shader (distance au trait de côte).
- Montagnes et collines : **symboles** (sprites SVG dessinés à la main) placés procéduralement depuis `height` (crêtes → rangées de pics), densité et taille selon le zoom (3–4 niveaux de LOD).
- Forêts : nuées de symboles d'arbres selon `biome` et densité ; motifs propres aux marais, déserts, prairies.
- Rivières : tracé encre depuis `flowAcc` / `flowDir`, largeur variable, méandres par bruit ; lacs en aplat.
- Routes : polylignes pleines ou pointillées ; routes de mer en pointillé.
- Lieux : icône (cité, bourg, ruine, forteresse, volcan…) + libellé en police serif auto-hébergée (licence OFL). Placement glouton anti-collision par niveau de zoom.
- Frontières d'anneaux : trait de faille discret, affichable / masquable.

### 5.3 Animations (phase 6)

- Eau : défilement de bruit le long de `flowDir` (rivières), vagues aux côtes, chute aux cascades — dans le shader, coût quasi nul.
- Volcans : `Place.kind = 'volcano'` + particules (fumée, lueur).
- Créatures : sprites sur trajectoires (boucles, points de passage), vitesse réglable ; décoratif.
- Time-lapse : lecture de la date à vitesse réglable, hydrologie précalculée par images-clés.

## 6. Édition MJ

- Conversion écran → (lon_monde, lat) → anneau → lon_local : tout outil écrit dans les couches locales.
- **Pinceau relief** : monter / baisser / lisser / aplatir ; taille, dureté, intensité ; mise à jour partielle de texture (`texSubImage2D`) ; recalcul hydro debounced.
- **Pinceau biome** : peint `biomeOverride` ; la gomme rétablit l'automatique.
- **Lieux** : clic pour poser, renommer inline, type / taille / icône, notes libres.
- **Routes** : tracé point à point, magnétisme sur les lieux, scission automatique aux frontières, option « suivre le relief » (A* sur coût pente + eau).
- **Anneaux et date** : sliders vitesse / sens, latitudes de coupure, date, rayon de la planète, niveau de la mer.
- **Undo / redo** : pile de commandes ; patchs rectangulaires avant / après pour les rasters.
- **Génération** : seed, taille des continents, rugosité, niveau de la mer, densité de villes ; régénérable tant que le MJ n'a pas édité (avertissement sinon).

## 7. Sauvegarde, partage, export

- Fichier `.pangee` = zip (fflate) : `world.json` (config, anneaux, lieux, routes, créatures, métadonnées) + `height.bin` (Float32 ou Uint16 quantifié) + `biome.bin` + `fog.bin`. Champ `formatVersion` pour les migrations.
- Sauvegarde automatique dans IndexedDB ; export / import explicites ; plusieurs mondes.
- **Export PNG** : sélection d'un rectangle, largeur de sortie (jusqu'à ~8k px), rendu hors écran à la date courante, décorations optionnelles (cartouche titre, rose des vents, échelle, date), téléchargement.
- **Brouillard de guerre** : pinceau « révéler / cacher » sur le masque `fog`, en référentiel local — ce que les joueurs ont vu suit le terrain quand l'anneau tourne. À l'export, les zones non révélées sont remplacées par du parchemin vierge (« Terra incognita »), bord adouci. Aperçu du brouillard dans l'éditeur.

## 8. Stack technique

| Besoin | Choix | Pourquoi |
|---|---|---|
| Langage | TypeScript strict | modèle et algorithmes typés, typed arrays |
| Build | Vite | rapide, workers et WASM natifs |
| Rendu | PixiJS v8 | 2D, shaders custom, sprites instanciés, texte |
| UI | React 19 + Zustand + Tailwind | panneaux, état global simple |
| Calcul | Web Workers + Comlink | génération et hydrologie hors du thread UI |
| Bruit | simplex-noise | fBm, domain warping |
| Fichiers | fflate, idb-keyval | zip, IndexedDB |
| Tests | Vitest (modèle, hydro sur petites grilles), Playwright (fumée UI) | |
| Déploiement | GitHub Actions → GitHub Pages (ou Cloudflare Pages) | statique, gratuit |
| Plus tard | Rust → WASM (wasm-pack) pour hydro / érosion si la perf ne suffit pas | |

Structure :

```
src/
  model/    types, anneaux, coordonnées, format de fichier (pur, testé)
  gen/      génération procédurale (worker)
  hydro/    assemblage, priority-flood, accumulation, lacs / rivières (worker)
  climate/  température, humidité, biomes
  render/   app Pixi, shader terrain, symboles, libellés, export PNG
  edit/     outils, undo / redo
  ui/       panneaux React
  store/    état Zustand
  workers/  points d'entrée Comlink
  assets/   symboles SVG, polices, parchemin
```

## 9. Phases

### Phase 0 — Squelette

Vite + TS + React + Pixi, lint / format, Vitest, workers Comlink, CI de déploiement Pages. Types du modèle (§3), format `.pangee` vide, store.
Livrable : page déployée avec un canvas Pixi et un panneau vide.

### Phase 1 — Monde qui tourne

Génération procédurale du relief (seed), shader terrain (couleur altitude / profondeur, ombrage), caméra pan / zoom / wrap, panneau anneaux + date + niveau de mer.
Livrable : monde généré ; on change la date et les trois bandes glissent, les côtes se cisaillent.
Critères : 60 fps en 1080p ; décalage exact au flottant ; t = t0 → carte alignée.

### Phase 2 — Hydrologie statique

Worker : assemblage, priority-flood, D8, accumulation, lacs, cascades / falaises. Rendu rivières / lacs / océan depuis les textures hydro. Debounce et indicateur « recalcul ».
Livrable : rivières cohérentes ; déplacer un anneau bloque une rivière → lac ou inondation visible.
Critères : tests unitaires sur grilles 8×8 / 32×32 (niveau de lac = seuil de débordement, wrap horizontal, cuvette créée par cisaillement) ; < 1 s en 2048×1024.

### Phase 3 — Style carte fantasy

Climat + biomes, parchemin, côtes hachurées, symboles montagnes / forêts avec LOD, tracé encre des rivières, libellés anti-collision, ligne de faille.
Livrable : une capture d'écran qui ressemble à une carte de roman.

### Phase 4 — Édition

Pinceaux relief / biome, lieux, routes (scission aux frontières), undo / redo, sauvegarde IndexedDB, export / import `.pangee`, générateur de noms.
Livrable : le MJ refait son monde de A à Z et le retrouve au rechargement.

### Phase 5 — Partage

Export PNG d'une zone avec décorations ; brouillard de guerre (pinceau, masque à l'export, aperçu).
Livrable : image prête à poster aux joueurs.

### Phase 6 — Animations

Eau animée, volcans, créatures, mode time-lapse.

### Phase 7 — Approfondissements (selon besoin)

Hydrologie volumétrique, érosion à la génération, résolution 4096, WASM, emprise urbaine `urban`, plusieurs jeux de brouillard (une par campagne), globe 3D en vue d'ensemble.

## 10. Risques et parades

| Risque | Parade |
|---|---|
| Hydrologie trop lente pendant le scrub de date | worker + debounce, décalage terrain immédiat, précalcul par images-clés pour le time-lapse, WASM en réserve |
| Libellés illisibles ou superposés | anti-collision par zoom, priorité par taille de lieu, masquage progressif |
| Rendu « plastique », loin du style livre | symboles dessinés à la main dès la phase 3, palette limitée, comparaison à des références (Tolkien, Lancedragon) |
| Éditions perdues | autosave IndexedDB + export régulier + versionnage du format |
| Artefacts aux frontières (bandes d'une cellule) | arrondi cohérent à l'assemblage, frontière rendue exactement à la latitude de coupure dans le shader |
| Portée qui gonfle | phases livrables indépendantes ; animations après le cœur |

## 11. Points à trancher plus tard

- Rayon de la planète et calendrier (noms de mois ?) — simples paramètres.
- Pluie climatique (moussons, zones arides) ou uniforme.
- Marées ou niveau de mer variable dans le temps.
- Convention de nommage des villes coupées.
- Comportement de la mer aux frontières : aucun (surface plane) — à confirmer.

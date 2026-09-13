# Hydrologie

Comment l'eau est calculée à partir du relief, à chaque date de campagne. Code : `src/hydro/`,
pur, sans DOM, exécuté dans un Web Worker. Tests obligatoires sur grilles jouets.

## Ce qu'on veut raconter

Les anneaux glissent, une vallée se retrouve barrée par un massif venu d'ailleurs, la rivière qui
la drainait n'a plus d'issue : elle remplit la cuvette jusqu'au premier col, un lac naît, et si le
col est bas la plaine d'à côté est inondée. Ce comportement **ne doit pas être codé en dur** : il
doit tomber tout seul d'un algorithme de remplissage correct. C'est le critère de conception de
toute cette partie.

## Vue d'ensemble du pipeline

```
height (local, Float32)
   │  assemblage : décalage de chaque bande de Δλ_r(t)
   ▼
heightWorld (monde)
   │  + seaLevelM, pluie uniforme
   ▼
priority-flood ──► filled
   │
   ├─► D8 ──► flowDir ──► accumulation ──► flowAcc ──► rivières
   ├─► lacs (filled > height + ε) ──► lakeId, waterLevel
   └─► frontières ──► cascades, falaises de faille
```

Sortie : un `HydroState` de couches en **référentiel monde**, consommé par le rendu.

## 1. Assemblage

Pour chaque ligne `y`, on détermine l'anneau par la latitude de la ligne, puis on décale la ligne
de `Δλ_r(t)` converti en cellules et **arrondi à la cellule entière**, avec wrap horizontal.

L'arrondi est assumé : le calcul CPU travaille sur une grille, il lui faut des indices entiers.
Le rendu, lui, applique le décalage flottant exact dans le shader ([le rendu](rendu.md)). L'écart
maximal entre les deux est d'une demi-cellule, invisible sous l'encre et les hachures, mais
l'arrondi doit être **cohérent** (même fonction, même sens) entre l'assemblage et tout autre
calcul CPU, sous peine d'artefacts d'un pixel le long des coupures.

## 2. Océan

Composantes connexes de `heightWorld < seaLevelM`, en 4-connexité, avec wrap horizontal. La plus
grande est la mer ; les autres deviennent aussi des mers si leur surface dépasse un seuil (une mer
intérieure reste une mer), sinon elles seront traitées comme des lacs par l'étape suivante.

Le niveau de mer est un réglage, pas une constante à `0` : le relief est stocké en mètres réels
et déplacer la mer doit redessiner les côtes sans toucher à `height`.

## 3. Remplissage des dépressions — priority-flood

Algorithme de Barnes, Lehman & Mulla (2014), version « priority-flood + ε » adaptée au cylindre.

```
file de priorité (min-heap sur l'altitude)
amorçage : toutes les cellules d'océan, à seaLevelM
          + les bords nord et sud (le monde n'est pas fermé en latitude)
tant que la file n'est pas vide :
    c ← cellule de plus faible altitude
    pour chaque voisin n non visité (wrap en x) :
        filled[n] ← max(heightWorld[n], filled[c] + ε)
        pousser n avec filled[n]
```

Propriétés :

- `filled ≥ heightWorld` partout, et toute cuvette fermée est remplie **exactement jusqu'à sa
  cote de débordement** — c'est-à-dire l'altitude du point de col le plus bas par lequel elle
  s'écoule. C'est précisément le comportement « rivière barrée → lac » recherché.
- L'ordre de sortie de la file est un **tri topologique** de l'écoulement : les plats sont résolus
  sans boucle ni cellule orpheline, sans passe supplémentaire.
- Le `ε` (quelques millimètres) garantit une pente strictement décroissante sur les plats et évite
  les directions D8 indéfinies. Il est négligeable devant le relief mais doit être documenté, car
  il est visible sur les tests en grille jouet.
- Le **wrap horizontal** est intégré au voisinage, pas simulé par duplication de colonnes : une
  rivière qui traverse le méridien ±180 est un cas normal, et c'est un test.

Complexité `O(n log n)` sur `n = width × height`.

## 4. Directions d'écoulement — D8

Sur `filled`, chaque cellule pointe vers celui de ses 8 voisins qui offre la plus forte pente
descendante (dénivelé divisé par la distance, `√2` en diagonale). Wrap en x, bords nord et sud
traités comme exutoires. `flowDir` est un `Uint8Array` encodant la direction sur 3 bits, plus une
valeur réservée pour « pas d'écoulement » (océan, exutoire).

D8 plutôt que D-infinity ou MFD : les rivières d'une carte de roman sont des traits d'encre, pas
des nappes de ruissellement. D8 donne des cours d'eau nets, se calcule vite, et se rend
directement.

## 5. Accumulation

Chaque cellule reçoit une unité de pluie (pluie **uniforme** en v1), puis on propage vers l'aval
en suivant `flowDir` **dans l'ordre inverse de sortie de la file de priorité**. Comme cet ordre
est topologique, une seule passe suffit : pas de récursion, pas de file de travail, pas de risque
de dépassement de pile.

- Rivière si `flowAcc > riverThreshold`.
- Largeur de trait ∝ `√flowAcc` : le débit croît comme la surface drainée, la largeur comme sa
  racine, ce qui donne visuellement le bon étagement ruisseau → fleuve.

Les seuils sont exprimés **en fraction de la surface totale**, pas en nombre de cellules, sinon
passer de 2048×1024 à 4096×2048 quadruple les débits et fait disparaître toutes les rivières.
Tout seuil ajouté ici doit suivre la même règle.

## 6. Lacs

Un lac est une composante connexe de cellules où `filled > heightWorld + ε`, hors océan. Pour
chacun on produit :

| Donnée        | Calcul                                                            |
| ------------- | ----------------------------------------------------------------- |
| `lakeId`      | index de composante, `0` = pas de lac                             |
| niveau        | valeur de `filled` sur la composante (constante par construction) |
| surface       | nombre de cellules × surface de cellule à la latitude             |
| exutoire      | la cellule de col par laquelle la composante déborde              |
| débit entrant | somme des `flowAcc` entrant dans la composante                    |

`waterLevel` fusionne mer et lacs en une seule couche pour le rendu : altitude de la surface
d'eau, ou sentinelle si la cellule est sèche.

### Ce qui mérite d'être appelé un lac

Un relief de bruit fractal compte des milliers de minima locaux de un ou deux mètres. Le
remplissage les traite correctement — ils comptent pour l'écoulement, et `filled` les conserve —
mais les afficher en eau criblerait la carte de taches : sur un premier essai en 2048 × 1024, on
relevait 6 616 « lacs ».

Une cuvette n'est donc retenue comme lac que si sa **profondeur** au point le plus bas dépasse
`MIN_LAKE_DEPTH_M` (15 m par défaut). Le critère est la profondeur et non la surface : à cette
résolution une seule cellule couvre déjà une vingtaine de kilomètres, la surface ne discrimine
rien. Le même monde tombe alors à environ 500 lacs.

Ce filtre est **cosmétique et ne touche pas à l'hydrologie** : `filled`, `flowDir` et `flowAcc`
sont calculés sur toutes les cuvettes, retenues ou non.

## 7. Effets de frontière

Deux phénomènes naissent du cisaillement aux coupures, et ils font une bonne part de l'identité
visuelle du monde :

- **Cascade** : un cours d'eau franchit une coupure et trouve, de l'autre côté, un terrain
  nettement plus bas. Si la chute dépasse un seuil, on marque une cascade au point de
  franchissement.
- **Falaise de faille** : `|Δh|` entre les deux lignes adjacentes de part et d'autre d'une
  coupure. Au-dessus d'un seuil, on marque un escarpement, rendu comme un trait d'encre appuyé.

Ces marques sont produites ici parce qu'elles se déduisent du relief assemblé ; leur rendu est
décrit dans [le rendu](rendu.md).

## Budget de performance

| Grille      | Cellules | Mesure               |
| ----------- | -------- | -------------------- |
| 2048 × 1024 | 2,1 M    | ~0,87 s              |
| 4096 × 2048 | 8,4 M    | ~4 s, option assumée |

Mesures relevées par `npm run bench` (`scripts/bench-hydro.ts`), en JavaScript, dans un worker,
sur un portable de développement. La répartition compte autant que le total : le priority-flood
pèse environ 70 % du temps, les directions D8 environ 20 %, l'accumulation et les lacs le reste.
C'est donc le remplissage qu'il faudra attaquer si le budget devient trop serré.

Règles pour tenir ce budget, en complément des [conventions](conventions.md) :

- Typed arrays partout, **aucune allocation dans les boucles chaudes**, pas d'objet `{x, y}`.
- Tampons réutilisés d'un appel à l'autre (le worker garde son état).
- Tas binaire sur `Int32Array`/`Float32Array`, pas un tableau d'objets.
- Résultats transférés en `Transferable`, jamais copiés.
- Debounce de 150 ms côté UI ; le terrain se décale sans attendre l'eau.

Si ce budget devient insuffisant (résolution 4096, érosion, time-lapse dense), la parade prévue
est une réécriture de ce module en Rust compilé en WASM. L'interface `computeHydro` est conçue
pour que cette substitution ne touche à rien d'autre.

## Tests

Sur grilles jouets de 8×8 à 32×32, dessinées en commentaire dans le fichier de test :

1. Cuvette fermée entourée d'un rebord → le niveau du lac vaut exactement la cote du col.
2. Rivière traversant le méridien ±180 → `flowAcc` continu, pas de coupure au wrap.
3. Pente uniforme → `flowAcc` croît linéairement vers l'aval.
4. Plat parfait entre deux pentes → écoulement résolu, aucune cellule sans direction.
5. Décalage d'anneau créant un barrage → un lac apparaît, au niveau attendu, sans code dédié.
6. Deux cuvettes emboîtées → la petite déborde dans la grande avant que la grande ne déborde.

## v2 — hydrologie volumétrique

Hors périmètre v1, mais **la signature est fixée dès maintenant** pour que la bascule ne casse
aucun appelant :

```ts
function computeHydro(input: HydroInput, prev?: HydroState, dtDays?: number): HydroState;
```

En v1, `prev` et `dtDays` sont ignorés : le résultat ne dépend que de `input`, l'eau est à
l'équilibre instantané. En v2, on suit un **volume par lac** : courbe hauteur/volume tabulée à
partir de l'hypsométrie de la cuvette, apports = `flowAcc` × pluie × `dtDays`, pertes =
débordement + évaporation. Un lac se remplit alors progressivement, peut s'assécher, et le
time-lapse montre la montée des eaux au lieu d'un saut d'un état d'équilibre à l'autre.

## Points ouverts

- Pluie uniforme ou pluie climatique (orographique, ombre pluviométrique) ?
- Niveau de mer variable dans le temps.
- Surface de la mer aux frontières d'anneaux : plane, supposé, à confirmer.
- Érosion hydraulique (phase 7).

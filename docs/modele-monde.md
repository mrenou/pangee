# Modèle du monde

Ce document définit les coordonnées, les référentiels, les anneaux, les couches raster et les
objets vectoriels de Pangée. C'est la référence normative : tout le reste du code s'y conforme.
Le code correspondant vit dans `src/model/`, pur, sans DOM ni Pixi.

## Géométrie de la planète

Pangée est traitée comme un **cylindre** déroulé en projection équirectangulaire :

| Grandeur         | Domaine                     | Remarque                                          |
| ---------------- | --------------------------- | ------------------------------------------------- |
| Longitude `lon`  | `[-180, 180[`               | **wrap** : `-180` et `+180` sont le même méridien |
| Latitude `lat`   | `[-90, 90]`                 | pas de wrap, on **clamp**                         |
| Rayon `radiusKm` | configurable, défaut `6371` | sert aux conversions °/jour ↔ km/jour             |

La déformation aux pôles est assumée : c'est une carte de roman, pas un atlas. Les distances
affichées à l'utilisateur sont calculées à la latitude concernée :

```ts
const kmPerDegLon = (lat: number) => (Math.PI / 180) * radiusKm * Math.cos(toRad(lat));
const kmPerDegLat = () => (Math.PI / 180) * radiusKm;
```

## Le Cataclysme et les deux référentiels

C'est le point central du modèle. Il y a **deux systèmes de coordonnées** et il ne faut jamais
les confondre.

### Référentiel local — le stockage canonique

Le monde est stocké **tel qu'il était avant le Cataclysme**, anneaux alignés. Toutes les données
persistées — rasters, lieux, routes, brouillard — vivent dans ce référentiel. On note les
longitudes `lonLocal`.

Conséquences, qui sont autant de raisons d'avoir choisi ce référentiel :

- Changer la vitesse d'un anneau ou la date de campagne **ne modifie aucune donnée**. Aucune
  perte, aucune dérive cumulative, aucune resynchronisation à faire.
- À `t = t0`, l'affichage montre exactement le monde d'avant : le MJ peut toujours revenir au
  plan d'origine de ses villes.
- Deux MJ (ou le MJ et ses joueurs) qui ouvrent le même fichier à la même date voient
  rigoureusement la même carte. L'état est une **fonction pure de la date**.

### Référentiel monde — l'affichage à la date t

À la date `tDays`, chaque anneau a tourné de `Δλ_r(t)`. La longitude affichée est :

```
lonWorld = lonLocal + Δλ_r(t)          (mod 360, ramené dans [-180, 180[)
Δλ_r(t)  = ω_r · (t − t0)              (mod 360)
```

La latitude, elle, est identique dans les deux référentiels : les anneaux tournent, ils ne
glissent pas en latitude. Le détail du temps, des unités et de la réversibilité est dans
[le temps](temps.md).

L'inverse, utilisé par tous les outils d'édition, est immédiat :

```
lonLocal = lonWorld − Δλ_r(t)
```

## Anneaux

Trois anneaux, fixes en nombre, séparés par **deux latitudes de coupure** réglables.

```ts
type RingId = 'north' | 'equator' | 'south';

interface Ring {
  readonly id: RingId;
  readonly omegaDegPerDay: number; // signé ; 0 = anneau immobile
}

interface RingConfig {
  readonly cutNorthLat: number; // frontière nord/équateur
  readonly cutSouthLat: number; // frontière équateur/sud
  readonly rings: Readonly<Record<RingId, Ring>>;
  readonly t0: number; // date du Cataclysme, défaut 0
}
```

L'appartenance d'une latitude à un anneau :

```ts
function ringOf(lat: number, cfg: RingConfig): RingId {
  if (lat > cfg.cutNorthLat) return 'north';
  if (lat < cfg.cutSouthLat) return 'south';
  return 'equator';
}
```

Les frontières sont **nettes** : pas de zone de transition, pas d'interpolation. Une cellule
appartient à un anneau et à un seul. Le cisaillement à la frontière est l'effet recherché —
villes coupées en deux, routes tranchées, falaises de faille.

### Invariants

| Invariant                                       | Vérification                           |
| ----------------------------------------------- | -------------------------------------- |
| `cutSouthLat < cutNorthLat`                     | validé à la construction et à l'import |
| `cutSouthLat` et `cutNorthLat` dans `]-90, 90[` | un anneau ne peut pas être vide        |
| Un `Place` appartient à exactement un anneau    | `ringId === ringOf(lat)`               |
| Un `Road` appartient à exactement un anneau     | scission à la création, voir plus bas  |
| `omegaDegPerDay` fini                           | `Number.isFinite`                      |

## Couches raster

Toutes en **référentiel local**, couvrant la planète entière, indexées `y * width + x`.
Résolution de base `2048 × 1024`, option `4096 × 2048`. Voir [les conventions](conventions.md)
pour les règles d'accès (`idx`, `wrapX`, zéro allocation en boucle chaude).

| Couche          | Type           | Résolution | Rôle                                                                                |
| --------------- | -------------- | ---------- | ----------------------------------------------------------------------------------- |
| `height`        | `Float32Array` | pleine     | altitude en mètres ; **négatif = sous le niveau de la mer**                         |
| `biomeOverride` | `Uint8Array`   | pleine     | `0` = biome automatique, sinon biome forcé par le MJ                                |
| `urban`         | `Uint8Array`   | pleine     | emprise bâtie (v1.1) ; c'est ce qui permet la ville coupée en deux                  |
| `fog`           | `Uint8Array`   | basse      | brouillard de guerre, `0` = inconnu, `255` = révélé — voir [le partage](partage.md) |

`height` est stocké en mètres réels et non en valeur normalisée : le niveau de la mer
(`seaLevelM`) est un réglage indépendant, et le déplacer doit changer le trait de côte sans
retoucher le relief.

Le micro-détail sous la taille d'une cellule n'est pas stocké : il est ajouté
procéduralement dans le shader au zoom, voir [le rendu](rendu.md).

## Couches dérivées

Recalculées, jamais persistées, exprimées en **référentiel monde** pour la date courante :

| Couche                                       | Produite par   | Contenu                                                                                             |
| -------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `heightWorld`                                | assemblage     | `height` avec chaque bande décalée de `Δλ_r(t)`                                                     |
| `waterLevel`, `flowAcc`, `flowDir`, `lakeId` | `src/hydro/`   | voir [l'hydrologie](hydrologie.md)                                                                  |
| `biome`                                      | `src/climate/` | température (latitude + altitude), humidité (distance à l'eau + bruit), `biomeOverride` prioritaire |

L'assemblage arrondit le décalage à la cellule pour le calcul CPU ; le rendu, lui, applique un
décalage **flottant exact** dans le shader. Cette asymétrie est délibérée et documentée dans
[le rendu](rendu.md).

## Objets vectoriels

En référentiel local eux aussi, avec l'anneau stocké explicitement.

```ts
type PlaceKind = 'city' | 'town' | 'village' | 'ruin' | 'fortress' | 'volcano' | 'landmark';

interface Place {
  readonly id: string;
  readonly ringId: RingId;
  readonly lon: number; // lonLocal
  readonly lat: number;
  readonly name: string;
  readonly kind: PlaceKind;
  readonly size: 1 | 2 | 3 | 4;
  readonly notes?: string;
}

interface Road {
  readonly id: string;
  readonly ringId: RingId;
  readonly points: readonly (readonly [number, number])[]; // [lonLocal, lat]
  readonly kind: 'road' | 'path' | 'sea-route';
}
```

### Une route ne traverse jamais une coupure

Une route tracée à cheval sur une frontière est **scindée dès sa création** : on insère un point
exactement à la latitude de coupure (interpolation linéaire sur le segment qui la franchit), puis
on produit deux `Road` distincts, un par anneau. Ensuite, les deux moitiés divergent naturellement
avec le temps, chacune portée par son anneau — c'est exactement ce qu'on veut raconter.

L'alternative (une route unique découpée à l'affichage) a été écartée : elle obligerait chaque
consommateur à connaître les coupures, et rendrait l'édition d'une moitié ambiguë.

### Une ville à cheval sur une coupure

Un `Place` appartient à un seul anneau, donc une ville tranchée se représente par :

1. l'emprise `urban` peinte des deux côtés de la coupure (le tissu bâti est un raster, il se
   décale avec son anneau) ;
2. **un `Place` par côté**, avec des noms qui peuvent diverger (« Haute-Bruyère » / « Bruyère-la-Basse »).

Le nommage des deux moitiés reste un point ouvert, voir [les décisions](decisions.md).

## Points ouverts

- Rayon planétaire et calendrier définitifs (longueur de l'année, noms des mois).
- Niveau de mer variable dans le temps.
- Convention de nommage automatique des villes coupées.
- Comportement exact de la mer aux frontières d'anneaux (surface plane supposée, à confirmer).

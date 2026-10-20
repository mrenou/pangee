# Le temps

Comment la date de campagne pilote la position des anneaux, quelles unités on manipule, et
pourquoi l'état du monde est reproductible. Code associé : `src/model/`, pur et testé.

## Date de campagne

La date est un **nombre de jours écoulés depuis le Cataclysme**, noté `tDays`. C'est un `number`,
pas un `Date` : il n'y a pas de calendrier grégorien dans Pangée, et la date peut être négative
(avant le Cataclysme) sans que rien ne casse.

`t0` est la date de référence à laquelle les anneaux sont alignés, par défaut `0`, c'est-à-dire
l'instant du Cataclysme. Il est stocké dans `RingConfig` pour rester réglable : un MJ peut
préférer caler le monde d'origine sur une autre date.

## Rotation des anneaux

```ts
function ringOffsetDeg(ring: Ring, tDays: number, t0: number): number {
  return wrapLon(ring.omegaDegPerDay * (tDays - t0));
}
```

Avec `wrapLon` qui ramène dans `[-180, 180[`. Trois propriétés en découlent, et elles sont
testées :

1. **`t = t0` ⇒ décalage nul pour tous les anneaux.** La carte affichée est le monde d'avant.
2. **Déterminisme.** L'état est une fonction pure de `(tDays, RingConfig, couches locales)`.
   Aucun état accumulé, aucune intégration pas à pas : sauter de l'an 12 à l'an 400 puis revenir
   donne bit à bit le même résultat que d'y aller directement.
3. **Réversibilité.** Modifier `omegaDegPerDay` ne détruit rien, puisque les données sont
   stockées en référentiel local. On peut régler la vitesse d'un anneau après avoir dessiné tout
   le monde.

Un `omegaDegPerDay` à `0` donne un anneau immobile — utile pour l'anneau équatorial si le MJ veut
un point fixe, ou pour comparer deux configurations.

## Unités et conversions

Le modèle raisonne en **degrés par jour**. L'interface, elle, parle en **kilomètres par jour**,
plus parlant pour un MJ qui veut savoir en combien de temps une ville frontalière s'éloigne de sa
voisine.

La conversion dépend de la latitude, puisqu'un degré de longitude rétrécit vers les pôles. On
affiche donc la vitesse **à la latitude médiane de l'anneau** :

```ts
const midLat = (ring: RingId, cfg: RingConfig): number => {
  switch (ring) {
    case 'north':
      return (cfg.cutNorthLat + 90) / 2;
    case 'equator':
      return (cfg.cutNorthLat + cfg.cutSouthLat) / 2;
    case 'south':
      return (cfg.cutSouthLat - 90) / 2;
  }
};

const kmPerDay = (omegaDegPerDay: number, lat: number, radiusKm: number): number =>
  omegaDegPerDay * (Math.PI / 180) * radiusKm * Math.cos(toRad(lat));
```

Avec le rayon par défaut de 6371 km :

| ω (°/jour) | km/jour à l'équateur | Ordre de grandeur                            |
| ---------- | -------------------- | -------------------------------------------- |
| `0.001`    | ≈ 0,11               | imperceptible à l'échelle d'une vie          |
| `0.01`     | ≈ 1,1                | un village décalé d'un kilomètre par an      |
| `0.1`      | ≈ 11                 | frontière mouvante, visible sur une campagne |
| `1`        | ≈ 111                | un tour complet en un an                     |
| `10`       | ≈ 1112               | un tour en 36 jours, monde chaotique         |

Le **signe** donne le sens : positif vers l'est, négatif vers l'ouest. L'interface montre le signe
sous forme de flèche, la valeur absolue sous forme de vitesse, et rappelle toujours l'unité,
conformément aux [conventions](conventions.md) sur les noms suffixés par leur unité.

L'écart de vitesse entre deux anneaux voisins est la grandeur qui compte vraiment pour le récit :
c'est elle qui détermine le cisaillement à la coupure. L'interface l'affiche explicitement.

## Ce que la date change, et ce qu'elle ne change pas

| Change avec `tDays`                      | Ne change pas                                   |
| ---------------------------------------- | ----------------------------------------------- |
| Le décalage `Δλ_r(t)` de chaque anneau   | Les rasters en référentiel local                |
| `heightWorld` et donc toute l'hydrologie | Les `Place` et `Road` (stockés en local)        |
| Les lacs, les rivières, les inondations  | Le brouillard `fog` (local, il suit le terrain) |
| Les biomes dérivés de l'eau              | Les latitudes de coupure et les vitesses        |

Une rivière qui coulait vers une vallée peut se retrouver barrée quand l'anneau voisin a glissé :
sa cuvette se remplit jusqu'au nouveau point de débordement, et un lac apparaît. Ce n'est pas un
cas particulier du code, c'est la conséquence mécanique du recalcul — voir
[l'hydrologie](hydrologie.md).

## Réglages exposés au MJ

| Réglage                      | Effet                                        | Coût                                  |
| ---------------------------- | -------------------------------------------- | ------------------------------------- |
| Date de campagne             | décale les anneaux                           | assemblage + hydrologie               |
| ω par anneau (valeur + sens) | change la loi de décalage                    | idem                                  |
| Latitudes de coupure         | redécoupe les bandes                         | idem, plus réaffectation des `ringId` |
| `t0`                         | recale l'origine                             | idem                                  |
| Rayon planétaire             | conversions km ↔ degrés, échelle des exports | affichage seulement                   |
| Niveau de mer                | trait de côte, océans                        | hydrologie                            |

Déplacer une latitude de coupure **réaffecte** les lieux et les routes dont l'anneau change. Pour
les routes, cela peut imposer une nouvelle scission, ou au contraire laisser deux moitiés
orphelines côte à côte : l'opération est une commande annulable comme les autres, décrite dans
[l'éditeur](editeur.md).

## Curseur de date et time-lapse

Le curseur de date est l'outil le plus utilisé : il doit rester fluide.

- Le **terrain** se décale immédiatement, sans aucun calcul CPU : le décalage est un uniforme du
  shader, voir [le rendu](rendu.md).
- L'**hydrologie** est recalculée dans un Web Worker, avec un debounce de 150 ms. Pendant le
  glissement on garde l'eau de la dernière date calculée ; elle rattrape le terrain dès l'arrêt.
- Le **time-lapse** (bouton Lire, vitesse de 1 à 365 jours par seconde) fait avancer la date au
  rythme du temps réel écoulé, par pas d'environ 33 ms : chaque pas redessine symboles, routes et
  rivières, et le faire à chaque image du navigateur saccadait la carte sans rien montrer de plus.
  Pendant la lecture, l'hydrologie est demandée **sans debounce** — un debounce ne laisserait
  passer aucun calcul tant que la date bouge — et le client du worker ne garde que la dernière
  demande : l'eau est recalculée au rythme du worker, et entre deux calculs le rattrapage de retard
  la fait glisser avec son anneau. La lecture s'arrête d'elle-même au bout du curseur. Voir
  [les décisions](decisions.md).

## Points ouverts

- Time-lapse par images-clés précalculées et interpolées, si le recalcul continu ne suffit plus
  (résolution 4096, hydrologie volumétrique).

- Longueur de l'année et calendrier de campagne (noms de mois, saisons).
- Faut-il faire varier le niveau de mer avec la date ?
- Saisons : la température dépend-elle de la date, ou seulement de la latitude ?

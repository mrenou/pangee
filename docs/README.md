# Documentation de Pangée

Pangée est un outil web pour un maître de jeu de rôle. Sa planète médiévale-fantastique a été
frappée d'un **Cataclysme** qui a découpé sa surface en **anneaux** — trois par défaut, nord, équateur,
sud, jusqu'à huit — tournant à des vitesses et dans des sens différents. Les villes sont coupées en deux, les plages
sont devenues des montagnes, les rivières se retrouvent barrées et forment des lacs. L'outil
affiche ce monde en carte de roman, le fait évoluer avec la date de campagne, laisse le MJ le
sculpter, et lui permet d'en exporter des morceaux pour ses joueurs.

Site statique, aucun backend : tout tourne dans le navigateur, tout se sauvegarde en local.

## Ordre de lecture

Pour découvrir le projet, dans cet ordre :

1. **[Le modèle du monde](modele-monde.md)** — coordonnées, anneaux, référentiel local et
   référentiel monde, couches raster, lieux et routes. Le vocabulaire de tout le reste.
2. **[Le temps](temps.md)** — date de campagne, rotation des anneaux, unités, déterminisme.
3. **[L'architecture](architecture.md)** — dossiers, flux de données, threads, CPU contre GPU.
4. **[Les conventions](conventions.md)** — règles TypeScript, rasters, nommage, tests, commits.

Puis, par sujet :

| Document                               | Sujet                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------- |
| [hydrologie.md](hydrologie.md)         | Océans, remplissage des dépressions, rivières, lacs, cascades             |
| [generation.md](generation.md)         | Génération procédurale : seed, bruit, continents, villes, noms            |
| [rendu.md](rendu.md)                   | Pipeline PixiJS, shader terrain, style carte de livre, symboles, libellés |
| [editeur.md](editeur.md)               | Pinceaux, lieux, routes, undo/redo, conversion écran → local              |
| [fichier-pangee.md](fichier-pangee.md) | Format `.pangee`, migrations, autosave IndexedDB                          |
| [partage.md](partage.md)               | Export PNG, brouillard de guerre                                          |
| [decisions.md](decisions.md)           | Journal des décisions structurantes et de ce qui a été écarté             |

## Glossaire

**Cataclysme** — l'événement qui a fracturé la planète en anneaux. Il sert d'origine des
temps : la date de campagne se compte en jours depuis le Cataclysme.

**t0** — date à laquelle les anneaux sont considérés comme alignés, par défaut `0`, c'est-à-dire
l'instant du Cataclysme. Réglable.

**Anneau** (`RingId`) — l'une des bandes de latitude, de une à huit, rangées du nord au sud, chacune
tournant à sa propre vitesse `omegaDegPerDay`, signée. Zéro signifie immobile. Son identifiant est
stable ; les trois anneaux d'origine s'appellent `north`, `equator` et `south`.

**Coupure** — l'une des latitudes frontières entre deux anneaux voisins, `cutsLat`, strictement
décroissantes. Une latitude de coupure appartient à l'anneau du sud. Les frontières sont nettes, sans
transition.

**Référentiel local** — les coordonnées du monde **tel qu'avant le Cataclysme**, anneaux alignés.
C'est le stockage canonique : relief, biomes, brouillard, lieux et routes y vivent tous. Les
longitudes y sont nommées `lonLocal`.

**Référentiel monde** — les coordonnées **affichées à la date `t`**, après rotation des anneaux.
Longitudes nommées `lonWorld`. On passe de l'un à l'autre par :

```
lonWorld = lonLocal + Δλ_r(t)      avec   Δλ_r(t) = ω_r · (t − t0)  (mod 360)
```

**Δλ_r(t)** — le décalage en longitude de l'anneau `r` à la date `t`. Nul pour tous les anneaux
quand `t = t0`.

**Couche dérivée** — donnée recalculée et jamais persistée, exprimée en référentiel monde :
`heightWorld`, `waterLevel`, `flowAcc`, `flowDir`, `lakeId`, `biome`.

**Falaise de faille** — l'escarpement créé le long d'une coupure quand les deux anneaux voisins
présentent des altitudes très différentes de part et d'autre.

**Brouillard de guerre** (`fog`) — le masque, stocké en référentiel local, des zones révélées aux
joueurs. Il suit donc le terrain quand les anneaux tournent.

## Maintenir cette documentation

Un changement de comportement met à jour le document correspondant **dans le même commit**. Toute
décision structurante ajoute une entrée datée dans [decisions.md](decisions.md). Les règles
détaillées sont dans [CLAUDE.md](CLAUDE.md).

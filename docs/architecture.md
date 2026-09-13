# Architecture

Vue d'ensemble technique : découpage en dossiers, flux de données, répartition entre threads et
entre CPU et GPU, règles de dépendance. À lire avant de toucher à `src/`.

## Contrainte de départ

Pangée est un **site statique**. Pas de serveur, pas de base de données, pas de compte
utilisateur : le monde vit dans le navigateur du MJ, sauvegardé en IndexedDB et exporté en
fichier `.pangee`. Cette contrainte structure tout le reste — les calculs lourds sont côté client,
donc ils vont dans des Web Workers, et la persistance est un problème de format de fichier, pas
de schéma relationnel.

## Dossiers

| Dossier | Responsabilité | Dépendances autorisées |
|---|---|---|
| `src/model/` | Types, anneaux, coordonnées, conversions local ↔ monde, format `.pangee` | aucune (pur) |
| `src/gen/` | Génération procédurale d'un monde depuis une seed | `model` |
| `src/hydro/` | Assemblage, priority-flood, D8, accumulation, lacs | `model` |
| `src/climate/` | Température, humidité, biomes dérivés | `model` |
| `src/render/` | PixiJS, shader terrain, symboles, libellés, export PNG | `model`, Pixi |
| `src/edit/` | Outils d'édition, commandes, undo/redo | `model`, `store` |
| `src/ui/` | Panneaux React | tout, mais aucune logique métier |
| `src/store/` | État Zustand, autosave | `model` |
| `src/workers/` | Points d'entrée Comlink des workers | `gen`, `hydro`, `climate` |
| `src/assets/` | SVG dessinés main, polices OFL, textures de parchemin | — |

### Règle de dépendance

`model`, `gen`, `hydro` et `climate` sont **purs** : aucun import de DOM, de Pixi, de React ou de
Zustand. Ils sont testables dans Node, sans navigateur, et c'est ce qui rend les tests de
`hydro` sur grilles jouets possibles et rapides. Cette règle est vérifiée par ESLint
(`no-restricted-imports`) et non par la discipline.

Le sens des dépendances est strict : `ui → edit → store → model`, et `render → model`. Rien ne
remonte. Si un module pur a besoin d'une information de l'interface, c'est le signe qu'il faut la
lui passer en paramètre.

## Flux de données

```
                 ┌──────────────────────────────────────────┐
   MJ ─ édite ──►│  couches LOCALES (référentiel d'avant)    │
                 │  height, biomeOverride, urban, fog        │◄── gen (worker)
                 │  Place[], Road[]                          │
                 └───────────────┬──────────────────────────┘
                                 │  + date de campagne, RingConfig
                                 ▼
                     assemblage : décalage Δλ_r(t)            ── worker hydro
                                 │
                                 ▼
                     heightWorld (référentiel monde)
                                 │
                     ┌───────────┴───────────┐
                     ▼                       ▼
              hydrologie                  climat
      waterLevel, flowAcc,                biome
      flowDir, lakeId
                     └───────────┬───────────┘
                                 ▼
                        textures GPU (monde)
                                 │
   height LOCAL en texture ──────┼──► shader terrain (décalage en uniforme)
                                 ▼
                       rendu Pixi + symboles + libellés
```

Le point important est le **double chemin du relief** :

- vers le CPU, `height` est assemblé en `heightWorld` pour l'hydrologie, avec un décalage arrondi
  à la cellule ;
- vers le GPU, `height` part **tel quel**, en référentiel local, et le décalage de chaque anneau
  est un simple uniforme du shader.

Le GPU n'attend donc jamais le CPU pour afficher le terrain à la bonne place : bouger le curseur
de date décale les bandes immédiatement, et l'eau rattrape 150 ms plus tard. Voir
[le rendu](rendu.md) et [le temps](temps.md).

## Threads

| Thread | Ce qui s'y passe |
|---|---|
| Principal | React, Zustand, boucle de rendu Pixi, saisie, outils d'édition |
| Worker `hydro` | Assemblage + hydrologie + climat, appelé en debounce |
| Worker `gen` | Génération procédurale, appelée à la demande |

Les workers sont exposés via **Comlink** : `src/workers/` ne contient que les points d'entrée et
la déclaration des méthodes, la logique restant dans les modules purs correspondants. Les
résultats volumineux (`Float32Array`, `Uint8Array`) sont renvoyés en **Transferable** pour éviter
la copie ; conséquence à connaître : le tampon transféré devient inutilisable côté worker, donc
le worker travaille sur ses propres tampons réutilisés et ne transfère que le résultat.

Aucune exception ne doit mourir silencieusement dans un worker : toute erreur est remontée à
l'interface, voir [les conventions](conventions.md).

## CPU contre GPU

| Sur GPU | Sur CPU |
|---|---|
| Colorisation du terrain, ombrage | Assemblage, hydrologie, climat |
| Décalage des anneaux (uniforme) | Génération procédurale |
| Micro-détail procédural au zoom | Placement des symboles et des libellés |
| Hachures de côte, grain, vignette | Undo/redo, persistance |
| Rendu hors écran pour l'export PNG | Découpe des routes, magnétisme |

La règle : ce qui est **par pixel et sans mémoire** va sur GPU, ce qui est **global et itératif**
reste sur CPU.

## Persistance

Deux mécanismes complémentaires, décrits dans [le format de fichier](fichier-pangee.md) :

- **Autosave IndexedDB** (`idb-keyval`), debounced, pour que fermer l'onglet ne perde rien ;
- **Export/import `.pangee`** (zip `fflate`), pour archiver, versionner et transporter un monde.

## Tests

| Niveau | Outil | Cible |
|---|---|---|
| Unitaire | Vitest | `model`, `hydro`, `climate`, `gen` — grilles jouets, invariants |
| Fumée | Playwright | l'application démarre, le canvas s'affiche, le curseur de date répond |

Les modules purs sont la zone où l'on investit en tests, parce qu'ils encodent les invariants du
monde et qu'une régression y est invisible à l'œil nu sur une carte.

## Déploiement

Build Vite, publication GitHub Pages par GitHub Actions. Aucune variable d'environnement
sensible, aucun secret : le site est entièrement statique et fonctionne hors ligne une fois
chargé.

## Pour aller plus loin

[Le modèle du monde](modele-monde.md) · [le temps](temps.md) ·
[l'hydrologie](hydrologie.md) · [la génération](generation.md) · [le rendu](rendu.md) ·
[l'éditeur](editeur.md) · [le format de fichier](fichier-pangee.md) ·
[le partage](partage.md) · [les conventions](conventions.md) · [les décisions](decisions.md)

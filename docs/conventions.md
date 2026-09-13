# Conventions de code

Langue : **documentation en français, code et identifiants en anglais**. Commentaires de code en
français quand ils expliquent un choix, en anglais quand ils nomment un concept technique.

La base TypeScript reprend les [TypeScript Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html),
complétée par les règles propres au projet listées plus bas.

## TypeScript — règles générales

- Types primitifs `number`, `string`, `boolean`, `symbol`, `object`. **Jamais** les types boxés
  `Number`, `String`, `Boolean`, `Symbol`, `Object`.
- **Pas de `any`.** Utiliser `unknown` puis rétrécir explicitement. Le seul endroit où `unknown`
  apparaît légitimement est la frontière de parsing d'un fichier importé.
- Pas de générique dont le paramètre de type n'est pas utilisé dans la signature. Un paramètre de
  type qui n'apparaît qu'une fois est presque toujours une erreur.
- Callbacks : type de retour `void` quand la valeur est ignorée (et non `any`, qui laisserait
  passer n'importe quel retour). Paramètres de callback **non optionnels** — un appelant qui ne
  passe pas l'argument est le problème de l'appelant, pas du type.
- Une seule signature de callback, d'arité maximale ; les paramètres non utilisés sont simplement
  omis par l'implémenteur.
- Surcharges : signatures **spécifiques avant** les générales. Préférer un paramètre optionnel à
  deux surcharges qui ne diffèrent que par la queue des arguments, et une **union** à deux
  surcharges qui ne diffèrent que par le type d'une position.

## Compilateur

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true, // arr[i] est T | undefined
  "exactOptionalPropertyTypes": true, // ?: T n'accepte pas undefined explicite
  "noImplicitOverride": true,
  "verbatimModuleSyntax": true,
}
```

`noUncheckedIndexedAccess` est volontairement activé malgré son coût en verbosité : ce projet est
plein d'indexation de tableaux, et une lecture hors bornes y est silencieuse. Dans les boucles
chaudes sur typed arrays, où l'index est prouvé valide, on lève la contrainte localement avec
`!` accompagné d'un commentaire justifiant l'invariant — pas ailleurs.

## Données et fonctions

- Les données sont des **`interface`**, manipulées par des **fonctions pures**. Pas de classes
  pour le modèle du monde : pas de méthodes, pas d'état caché, pas d'héritage.
- `readonly` par défaut sur tout ce qui est partagé entre modules ou stocké dans le store.
- Les unions discriminées (`kind`) plutôt que des booléens multiples ou des sous-classes.
- Les fonctions qui coûtent cher annoncent leur coût dans leur nom ou leur doc (`computeHydro`,
  pas `getHydro`).

## Rasters

- Toujours des **typed arrays** : `Float32Array` pour le relief, `Uint8Array` pour les couches
  catégorielles, `Int32Array` pour les index.
- Indexation `y * width + x`, systématiquement, via les helpers :

```ts
const idx = (x: number, y: number, width: number): number => y * width + x;
const wrapX = (x: number, width: number): number => ((x % width) + width) % width;
```

- **Aucune allocation dans une boucle chaude.** Pas de `{x, y}`, pas de `[a, b]` retourné par
  itération, pas de fermeture créée par cellule, pas de `map`/`filter` sur des millions
  d'éléments. Les tampons de travail sont alloués une fois et réutilisés.
- La latitude se clamp, la longitude se wrap. Jamais l'inverse.

## Nommage

- **L'unité est dans le nom** : `omegaDegPerDay`, `heightM`, `seaLevelM`, `tDays`, `radiusKm`,
  `kmPerDay`. Un nombre nu sans unité dans son nom est un bug en attente.
- **Le référentiel est dans le nom** dès qu'il y a ambiguïté : `lonLocal` contre `lonWorld`,
  `height` (local) contre `heightWorld`. Voir [le modèle du monde](modele-monde.md).
- Les angles sont en **degrés** dans le modèle et dans les données persistées. Les radians
  n'existent qu'en variable locale au sein d'un calcul, jamais dans une interface.
- Types et interfaces en `PascalCase`, valeurs et fonctions en `camelCase`, constantes de module
  en `SCREAMING_SNAKE_CASE` seulement si elles sont réellement des constantes de configuration.

## Frontières de modules

- `model/`, `hydro/`, `gen/`, `climate/` : **aucun import de DOM, Pixi, React ou Zustand**. Règle
  appliquée par ESLint, pas par la discipline. Voir [l'architecture](architecture.md).
- `ui/` ne contient pas de logique métier : un composant lit le store et appelle une commande.
- `render/` ne décide de rien : il affiche ce que le modèle lui donne.

## Erreurs

- Aux frontières où l'échec est attendu et fréquent — import d'un fichier `.pangee`, parsing de
  `world.json` — on renvoie un résultat explicite plutôt que de lever :

```ts
type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
```

- Ailleurs, on lève une erreur typée, et **jamais un `throw` silencieux dans un worker** : toute
  exception d'un worker est capturée au point d'entrée Comlink et remontée à l'interface sous une
  forme affichable. Un worker qui meurt sans message est un bug en soi.
- Pas de `console.log` en dehors du développement ; les diagnostics durables passent par un
  helper de log activable.

## Tests

- **Vitest**, fichiers `*.test.ts` **à côté du code** testé.
- Les cas sont des **grilles jouets** de 8×8 à 32×32, dessinées en commentaire au-dessus du test
  pour qu'on puisse vérifier l'attendu à l'œil :

```ts
// Cuvette fermée, col à l'est à 30 m :
//   50 50 50 50
//   50 10 20 30
//   50 15 10 50
//   50 50 50 50
// Attendu : lac à 30 m sur les quatre cellules intérieures.
```

- Ce qui doit être testé en priorité : les invariants du modèle, les conversions local ↔ monde
  aller-retour, le wrap, et tout l'étage hydrologie.

## Outillage

- **ESLint + Prettier**, exécutés en CI ; le formatage n'est pas un sujet de revue.
- Imports absolus `@/…` (alias Vite + `tsconfig`), pas de `../../..`.
- **Conventional Commits** : `feat(hydro): priority-flood avec wrap horizontal`. Le corps explique
  le _pourquoi_ quand il n'est pas évident, jamais le _quoi_ — le diff le dit déjà.
- Un commit = une unité cohérente livrée. Pas de commit « WIP » multi-sujets.
- Un changement de comportement et la mise à jour de sa documentation `docs/` vont **dans le même
  commit**.

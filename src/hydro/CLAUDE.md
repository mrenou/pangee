# src/hydro

Assemblage du relief à la date `t`, puis océans, priority-flood, D8, accumulation, lacs.

- **S'exécute dans un Web Worker**, appelé en debounce de 150 ms. Aucun import de DOM ni de Pixi.
- Signature figée dès la v1, y compris les paramètres inutilisés :
  `computeHydro(input, prev?, dtDays?)`. La v2 volumétrique s'y branchera sans casser d'appelant.
- Typed arrays uniquement, tampons alloués une fois et réutilisés entre les appels,
  **zéro allocation dans les boucles chaudes**. Le tas de priorité est sur typed arrays.
- Le wrap horizontal fait partie du voisinage, il n'est pas simulé par duplication de colonnes.
- Les seuils (rivière, cascade, faille) s'expriment en **fraction de la surface totale**, jamais
  en nombre de cellules : changer la résolution ne doit pas effacer les rivières.
- L'arrondi du décalage d'anneau à la cellule doit être identique partout côté CPU, sinon des
  artefacts d'un pixel apparaissent le long des coupures.
- **Tests sur grilles jouets obligatoires** (8×8 à 32×32, dessinées en commentaire) : cuvette
  fermée, wrap, plat, barrage créé par un décalage d'anneau.
- Budget : 0,3–0,6 s en 2048×1024. Résultats renvoyés en `Transferable`.

→ `docs/hydrologie.md`

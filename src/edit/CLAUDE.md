# src/edit

Outils d'édition du MJ : pinceaux, lieux, routes, réglages.

- **Toute écriture passe par une commande annulable** portant `apply` et `revert`. Rien ne modifie
  l'état directement, y compris les réglages d'anneaux et de coupures.
- **Toute écriture cible le référentiel local.** La chaîne est : point écran → `(lonWorld, lat)`
  par la caméra → `ringOf(lat)` → `lonLocal = lonWorld − Δλ_r(t)` → indices de cellule. Une
  édition faite à une date quelconque reste donc valable à toutes les dates.
- Les commandes raster stockent des **patchs rectangulaires** (bbox, avant/après), jamais le
  raster entier. Les coups de pinceau d'un même geste sont coalescés en une seule commande.
- Une route qui franchit une coupure est scindée **à la création**, avec un point inséré
  exactement à la latitude de coupure.
- Déplacer une coupure réaffecte les `ringId` des lieux et des routes : c'est une commande
  annulable comme les autres.
- Après une écriture sur `height`, mise à jour partielle de la texture et recalcul hydro debounced.

→ `docs/editeur.md`

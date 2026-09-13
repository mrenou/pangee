# src/gen

Génération procédurale d'un monde à partir d'une seed.

- **Déterministe.** Même seed et mêmes paramètres ⇒ même monde, bit à bit. Jamais `Math.random` :
  un PRNG explicite semé depuis la seed, avec des **sous-seeds dérivées par domaine** (relief,
  villes, noms) pour qu'un changement de densité de villes ne modifie pas le relief.
- **S'exécute dans un Web Worker.** Pas de DOM, pas de Pixi.
- Le bruit est échantillonné sur un cylindre (longitude projetée sur un cercle) : la couture au
  méridien ±180 doit être invisible. Atténuation aux pôles.
- La sortie est en **référentiel local** : `height` en mètres, `biomeOverride` laissé à 0, les
  `Place` et les `Road` avec leur `ringId`.
- Une route générée qui franchit une coupure est scindée en deux `Road`, comme à l'édition.
- Régénérer écrase les couches : l'appelant doit avertir si le monde a déjà été édité.

→ `docs/generation.md`

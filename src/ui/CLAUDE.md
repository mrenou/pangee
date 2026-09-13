# src/ui

Panneaux React, état Zustand. Présentation uniquement.

- **Aucune logique métier.** Un composant lit le store et déclenche une commande de `src/edit/`.
  Un calcul sur le monde qui apparaît ici est au mauvais endroit.
- Les valeurs sont affichées avec leur unité, et converties pour l'humain : le modèle raisonne en
  `omegaDegPerDay`, l'interface montre des km/jour à la latitude médiane de l'anneau, plus un sens
  (est/ouest). Voir `docs/temps.md`.
- Le curseur de date doit rester fluide : le terrain se décale immédiatement (uniforme de shader),
  l'hydrologie suit après un debounce de 150 ms. Ne jamais bloquer la saisie sur un calcul.
- Toute erreur remontée d'un worker doit être affichée ; aucune ne doit être avalée.
- Les actions destructrices (régénérer un monde déjà édité, importer par-dessus l'état courant)
  demandent confirmation.

→ `docs/editeur.md`, `docs/temps.md`

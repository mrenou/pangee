# Maintenir la documentation

- Un changement de comportement met à jour le document correspondant **dans le même commit** que
  le code. Une doc qui décrit un état passé est pire que pas de doc.
- Toute décision structurante ajoute une entrée datée dans `decisions.md` : ce qui est décidé,
  pourquoi, et ce qui a été écarté. On ne réécrit pas une décision passée, on en ajoute une qui la
  remplace en la référençant.
- Documentation en français, identifiants et noms de fichiers en anglais.
- Vocabulaire imposé, défini dans le glossaire de `README.md` : Cataclysme, t0, anneau, coupure,
  référentiel local (`lonLocal`), référentiel monde (`lonWorld`), couche dérivée.
- Ton : dense, sans remplissage, sans emoji. Tableaux et blocs de code plutôt que des paragraphes.
- Ce qui n'est pas tranché va sous un titre « Points ouverts » à la fin du document, et non dans
  une formulation vague au milieu du texte.
- Les liens entre documents sont relatifs (`[le temps](temps.md)`) et doivent résoudre ; la CI les
  vérifie.
- Un nouveau document s'ajoute au tableau de `README.md`, sinon personne ne le trouvera.

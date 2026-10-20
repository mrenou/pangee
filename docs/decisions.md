# Journal des décisions

Registre des décisions structurantes, sous forme d'ADR léger. Chaque entrée dit **ce qui a été
décidé**, **pourquoi**, et **ce qui a été écarté**. Une décision qu'on remet en cause n'est pas
effacée : on ajoute une entrée qui la remplace, en la référençant.

Règle : **toute décision structurante ajoute une entrée ici, dans le commit qui l'applique.**

---

## 2026-09-13 — Cadrage initial

Première session de cadrage avec le MJ. Les douze décisions ci-dessous fixent le périmètre de la
v1 et les orientations techniques.

### D1 — Carte de base générée procéduralement, puis éditée

**Décidé.** Le monde de départ est produit par un générateur déterministe à partir d'une seed, et
le MJ peut ensuite tout modifier. Voir [la génération](generation.md).

_Écarté :_ partir d'une carte blanche (trop long à remplir pour 50–150 villes), partir d'une carte
importée (pas de source libre adaptée à un monde imaginaire à trois anneaux).

### D2 — Vue 2D équirectangulaire, wrap est-ouest, zoom continu

**Décidé.** Carte plate, cylindrique, avec répétition infinie en longitude et zoom continu.

_Écarté :_ un globe 3D — plus juste géométriquement, mais contraire au style « carte de roman »,
plus coûteux à styliser, et mauvais pour l'export PNG d'une zone. Reporté en phase 7 comme vue
secondaire éventuelle.

### D3 — Trois anneaux fixes, deux coupures réglables, frontières nettes

**Remplacé par D13** (anneaux en nombre variable).

**Décidé.** `north` / `equator` / `south`, séparés par `cutNorthLat` et `cutSouthLat`, avec une
vitesse signée par anneau allant de quasi-immobile à très rapide. Voir
[le modèle du monde](modele-monde.md).

_Écarté :_ un nombre d'anneaux variable (complexité de l'interface et du modèle sans gain narratif
à ce stade) ; une zone de transition adoucie aux frontières (le cisaillement net est justement
l'élément dramatique du monde).

### D4 — Stockage en référentiel local, affichage en référentiel monde

**Décidé.** Le monde est stocké tel qu'avant le Cataclysme ; la position à la date `t` est
calculée par `lonWorld = lonLocal + Δλ_r(t)`. C'est la décision la plus structurante du projet.

_Pourquoi :_ changer une vitesse d'anneau ou la date ne détruit aucune donnée, `t = t0` redonne le
monde d'origine, et deux ouvertures du même fichier à la même date donnent exactement la même
carte.

_Écarté :_ stocker les positions courantes et les faire évoluer pas à pas — dérive numérique
cumulative, impossibilité de revenir en arrière, édition non reproductible.

### D5 — Date de campagne en jours depuis le Cataclysme, état déterministe

**Décidé.** `tDays` est un nombre de jours, l'état du monde est une fonction pure de la date. Un
time-lapse est prévu. Voir [le temps](temps.md).

_Écarté :_ un calendrier complet avec mois et saisons — reporté, non bloquant.

### D6 — Relief en mètres, niveau de mer réglable

**Décidé.** `height` en `Float32Array` de mètres, négatif sous la mer, avec un `seaLevelM`
indépendant.

_Écarté :_ une altitude normalisée `[0, 1]` — déplacer la mer y obligerait à retoucher le relief,
et les échelles affichées au MJ perdraient tout sens physique.

### D7 — Hydrologie statique en v1, recalculée à chaque date

**Décidé.** Priority-flood, D8, accumulation, lacs ; l'eau est à l'équilibre instantané. La
signature `computeHydro(input, prev?, dtDays?)` est fixée dès la v1 pour accueillir la version
volumétrique sans casser les appelants. Voir [l'hydrologie](hydrologie.md).

_Pourquoi :_ une rivière barrée par un anneau qui a glissé doit produire un lac **sans code
dédié**, par simple remplissage jusqu'au col.

_Écarté :_ la simulation volumétrique dès la v1 (coût de calcul et de conception disproportionné
avant d'avoir une carte à regarder).

### D8 — Édition par pinceaux, lieux et routes tracées à la main

**Décidé.** Pinceau relief, pinceau biome, lieux nommés, routes point à point avec magnétisme et
option A*. Tout passe par des commandes annulables. Voir [l'éditeur](editeur.md).

_Écarté :_ une édition purement paramétrique (régler des curseurs de génération) — insuffisant
pour un MJ qui a une intention narrative précise sur une vallée donnée.

### D9 — Partage par export PNG avec brouillard de guerre

**Décidé.** Le MJ cadre une zone, exporte un PNG à la date courante, et les zones non révélées
apparaissent en parchemin « Terra incognita ». Voir [le partage](partage.md).

_Écarté :_ une vue joueur en ligne avec comptes et permissions — impose un backend, contraire à
D12.

### D10 — Animations après le cœur fonctionnel

**Décidé.** Eau, volcans, créatures et time-lapse arrivent en phase 6, une fois le monde, l'eau,
le style et l'édition en place.

_Pourquoi :_ c'est le poste le plus susceptible de faire gonfler le périmètre sans rapprocher du
besoin réel, qui est de jouer.

### D11 — Échelle : 50–150 villes, relief 2048×1024

**Décidé.** Résolution de base 2048×1024, option 4096×2048 pour les mondes très travaillés. Ce
choix fixe le budget de l'hydrologie à 2,1 M de cellules, soit 0,3–0,6 s en JavaScript dans un
worker.

_Écarté :_ une résolution adaptative par région — complexité de gestion sans gain visible à cette
échelle.

### D12 — Site statique, aucun backend

**Décidé.** Déploiement GitHub Pages ou Cloudflare Pages, sauvegarde en IndexedDB et export de
fichier `.pangee`. Voir [le format de fichier](fichier-pangee.md).

_Pourquoi :_ pas de coût d'hébergement, pas de compte à gérer, pas de données personnelles, et le
MJ garde ses mondes chez lui.

_Écarté :_ un backend de synchronisation multi-joueurs — reporté indéfiniment, hors besoin
exprimé.

---

## Décisions techniques dérivées

Prises dans la foulée du cadrage, moins structurantes mais qui engagent le code :

| Décision                                                                               | Motif                                                                     | Alternative écartée                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| PixiJS v8 pour le rendu                                                                | shader custom sur un quad plein écran, écosystème 2D mûr                  | WebGL nu (trop de plomberie), Canvas 2D (pas de shader, trop lent) |
| Décalage des anneaux en **uniforme de shader**, pas en assemblage CPU pour l'affichage | décalage flottant exact, terrain instantané au scrub de date              | assemblage CPU pour l'affichage — latence et artefacts d'arrondi   |
| Web Workers + Comlink                                                                  | l'hydrologie ne doit jamais bloquer le curseur de date                    | calcul sur le thread principal                                     |
| Route scindée **à la création** aux coupures                                           | chaque consommateur ignore les frontières, l'édition reste sans ambiguïté | découpe à l'affichage seulement                                    |
| Seuils hydrologiques en **fraction de la surface**, pas en cellules                    | changer de résolution ne doit pas effacer les rivières                    | seuils absolus                                                     |
| Format `.pangee` = zip `fflate` + binaires séparés                                     | JSON pour le lisible, binaire pour les 2 M de cellules                    | tout en JSON (taille et parsing prohibitifs)                       |
| React 19 + Zustand + Tailwind                                                          | état global simple, panneaux nombreux, pas de routage                     | Redux (cérémonie inutile ici)                                      |
| Rust → WASM en réserve pour l'hydrologie                                               | parade prévue si 4096×2048 ou l'érosion dépassent le budget               | optimiser JS indéfiniment                                          |

---

## 2026-10-20 — Tracé des routes suivant le relief

**Décidé.** L'A* des routes vit dans `src/gen/roadPath.ts` et tourne sur le thread principal, au clic, dans
une fenêtre bornée à 600 000 cellules (moins de 100 ms en 2048×1024). Il évite la mer mais pas les lacs.

_Pourquoi :_ un seul coût pour l'option « suivre le relief » de l'éditeur et pour le futur réseau routier
généré ; un calcul ponctuel ne justifie pas un aller-retour de worker. Les lacs sont une couche dérivée en
référentiel monde, propre à une date, alors que la route est stockée en référentiel local.

_Écarté :_ un worker dédié (latence et plomberie pour un calcul de quelques dizaines de ms) ; une
recherche sur la planète entière (plusieurs centaines de ms, inutile pour relier deux clics).

---

## 2026-10-20 — Export PNG

**Décidé.** L'export rend la scène de l'éditeur elle-même, hors écran, sur le viewport du cadre ; le
brouillard y est un calque opaque posé au-dessus de tout. Au-delà de 1600 px de large, la scène est rendue
sur cette largeur logique puis agrandie par la transformation du rendu. Les décorations sont dessinées en
Canvas 2D sur l'image extraite.

_Pourquoi :_ un seul moteur de dessin, donc une image identique à ce que le MJ voit ; un brouillard au-dessus
de tout garantit que rien de caché ne filtre, libellés compris. L'agrandissement garde les ornements lisibles
à toute taille sans réécrire chaque couche pour une échelle de rendu.

_Écarté :_ un second moteur de rendu dédié à l'export (double maintenance) ; masquer le brouillard couche par
couche (un oubli suffit à révéler un nom) ; des tailles d'ornements fixes en pixels (illisibles à 8000 px) ;
le rendu par tuiles, gardé en réserve si le plafond de 8000 px devient gênant.

---

## 2026-10-20 — Time-lapse sans images-clés

**Décidé.** Pendant la lecture, l'hydrologie est recalculée en continu, au rythme du worker et sans
debounce ; entre deux calculs, le rattrapage de retard déjà utilisé pour le curseur de date fait glisser
l'eau avec son anneau. La date avance par pas d'environ 33 ms. Remplace, pour la v1, le précalcul par
images-clés prévu au cadrage (D5, [le rendu](rendu.md)).

_Pourquoi :_ interpoler deux états d'eau suppose deux jeux de textures monde et deux dates de rattrapage
dans le shader, pour un gain peu visible : à l'équilibre instantané, l'eau d'une date voisine décalée de son
anneau est déjà juste à une cellule près. Le recalcul continu ne demande rien de neuf.

_Écarté pour l'instant :_ les images-clés précalculées et interpolées, gardées en point ouvert de
[le temps](temps.md) pour le jour où le recalcul ne suivra plus.

---

## 2026-10-20 — D13 : anneaux en nombre variable (remplace D3)

**Décidé.** De un à huit anneaux, rangés du nord au sud et séparés par des latitudes de coupure. Le MJ en
ajoute en **scindant** un anneau existant en son milieu — la moitié sud hérite de sa vitesse — et en retire
en **fusionnant** deux voisins. Chaque anneau a un identifiant stable et un nom. Une latitude de coupure
appartient désormais à l'anneau du sud, au CPU comme dans le shader. Format `.pangee` en version 3. Les
toponymes suivent la latitude (trois cultures, à ±30°) et non plus l'anneau.

_Pourquoi :_ demande explicite du MJ, pour raconter des fractures plus fines que trois bandes. Le stockage
en référentiel local (D4) rend l'opération sûre : aucune coordonnée ne change, seul l'anneau porté par
chaque objet est recalculé. Huit suffit largement et garde des tableaux d'uniformes de taille fixe.

_Écarté :_ une liste libre de coupures sans identité d'anneau (les objets n'auraient plus de référence
stable) ; une moitié scindée immobile (elle sauterait à l'écran à toute date ≠ `t0`) ; des cultures de noms
par anneau (un anneau scindé n'a pas de culture évidente, et renommer les lieux au gré du découpage serait
destructeur). La zone de transition aux frontières reste écartée, comme en D3.

---

## 2026-10-20 — Publication sur GitHub Pages, après la CI (précise D12)

**Décidé.** Le dépôt est public, sous `mrenou/pangee`, et publié sur GitHub Pages à
<https://mrenou.github.io/pangee/>. La publication est un job `deploy` de `ci.yml`, qui dépend du job de
vérification et ne tourne que sur `main`. Sur le runner d'intégration, le budget de temps de
l'hydrologie vérifié par les tests de fumée passe de 1 s à 2,5 s ; il reste à 1 s en local.

_Pourquoi :_ un dépôt public rend Pages gratuit, sans compte supplémentaire ni secret à gérer. Un
workflow de publication séparé partait en parallèle de la CI et pouvait mettre en ligne un commit qui
casse les tests. Le runner partagé à deux cœurs mesure ~1,2 s ce qui prend ~350 ms sur un poste : un
budget de 1 s y échouait au hasard et aurait bloqué la publication.

_Écarté :_ Cloudflare Pages — utile seulement pour un dépôt privé ou des en-têtes HTTP sur mesure,
deux besoins absents ; un workflow `workflow_run` déclenché par la CI — un second fichier pour la même
chaîne, et un statut de publication détaché de celui du commit.

---

## 2026-10-20 — Licence Apache-2.0

**Décidé.** Le code est sous licence Apache-2.0 (`LICENSE`), avec un fichier `NOTICE` qui nomme le projet
et son auteur. Les deux fichiers ont été ajoutés à tout l'historique, depuis le premier commit, par
réécriture : aucune version publiée de Pangée n'est restée sans licence.

_Pourquoi :_ réutilisation libre, à condition de citer le projet. Apache-2.0 oblige tout dérivé
redistribué à reprendre `NOTICE`, ce qui rend la citation plus visible qu'une simple mention de copyright,
et couvre aussi les brevets.

_Écarté :_ MIT — même liberté, mais l'attribution se réduit à la mention de copyright ; CC BY 4.0 —
pensée pour les œuvres, pas pour le code ; une licence copyleft (GPL, AGPL) — imposerait la licence aux
dérivés, au-delà du besoin.

---

## Points à trancher plus tard

Décisions volontairement repoussées, à documenter ici quand elles seront prises :

- Rayon planétaire définitif et calendrier de campagne.
- Pluie uniforme ou pluie climatique (orographique, ombre pluviométrique).
- Niveau de mer variable dans le temps.
- Convention de nommage des villes coupées par une frontière.
- Comportement de la mer aux frontières d'anneaux : surface plane supposée, à confirmer.

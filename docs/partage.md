# Partage : export PNG et brouillard de guerre

Ce que le MJ donne à ses joueurs est une **image**, pas un accès à l'outil : un PNG cadré sur une zone, rendu
à la date de campagne courante, amputé de ce que les joueurs n'ont pas encore découvert. Tout se passe dans le
navigateur — voir aussi [le rendu](rendu.md) et [le format de fichier](fichier-pangee.md).

## Export PNG d'une zone

1. Le MJ trace un **rectangle de sélection** sur la carte (en coordonnées monde : `lonWorld`, `lat`, avec wrap
   est-ouest autorisé, donc une sélection peut chevaucher l'antiméridien).
2. Il choisit une **largeur de sortie en pixels**. La hauteur en découle du rapport d'aspect du rectangle, à
   projection équirectangulaire constante. Plafond ~8000 px.
3. L'application effectue un **rendu hors écran** dans une `RenderTexture` PixiJS, à une échelle
   `pxPerDeg = outputWidth / rectWidthDeg` **indépendante du zoom écran**. Le choix de niveau de détail des
   symboles (montagnes, forêts, libellés) est dérivé de cette échelle d'export, pas de celle de l'affichage :
   deux exports identiques faits à deux zooms différents donnent la même image.
4. La texture est extraite (`renderer.extract`), convertie en `Blob` PNG et téléchargée.

### Mise en œuvre

| Étape          | Code                                        | Détail                                                                                  |
| -------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Cadrage        | outil **Image**, `src/edit/editControls.ts` | glisser un rectangle ; `rectFromCorners` le prend par le plus court chemin en longitude |
| Plan           | `planExport`, `src/render/exportPlan.ts`    | hauteur, octets, refus motivé et largeur de repli                                       |
| Rendu          | `exportPng`, `src/render/mapRenderer.ts`    | même scène, viewport du cadre, `RenderTexture`, `extract.canvas`                        |
| Décorations    | `src/render/exportDecorations.ts`           | Canvas 2D sur l'image extraite                                                          |
| Téléchargement | `downloadBlob`, `src/store/persistence.ts`  | `<nom du monde> - jour <t>.png`                                                         |

Avant le rendu, tout ce qui n'est qu'un repère d'édition est retiré de la scène : cadre d'export, lieu et route
sélectionnés, tracé en cours. Le semis des symboles reçoit un budget à la taille de l'image (le plafond écran
de 4000 ne couvrirait que le haut d'un grand export) et renonce à sa texture figée, qui dépasserait la taille
maximale du GPU. Tout est rétabli après coup, que l'export réussisse ou échoue.

**Ornements à l'échelle de l'image.** Libellés, icônes et traits ont une taille en pixels écran. Jusqu'à
1600 px de large, l'export les garde tels quels ; au-delà, la scène est rendue sur une largeur logique de
1600 px puis agrandie d'un facteur `k = largeur / 1600` par la transformation du rendu, et les textes sont
rastérisés à la résolution `k`. Les tracés vectoriels restent nets, et un export de 8000 px a l'allure d'un
écran plutôt que des noms de dix pixels perdus dans l'image. Le niveau de détail dépend donc de la largeur
d'export, jamais du zoom de l'écran.

**Garde-fou mémoire.** Le coût est estimé avant le rendu : `outputWidth · outputHeight · 4` octets pour la
cible, davantage avec les tampons intermédiaires. Au-delà d'un seuil (quelques centaines de Mio) ou de la
taille de texture maximale du GPU, l'export est refusé avec une explication et une suggestion de largeur
acceptable, plutôt que de faire planter l'onglet. Valeurs retenues : trois copies de 4 octets par pixel
(cible, extraction, canvas des décorations) sous 512 Mio, côté sous `MAX_TEXTURE_SIZE`, largeur sous
8000 px. Le rendu par tuiles recollées est la porte de sortie si
cette limite devient gênante.

L'export se fait **à la date de campagne courante** : les anneaux sont dans la position qu'ils ont à `t`, donc
l'image montre le monde tel que les joueurs le voient à ce moment de la campagne. Changer la date et
réexporter la même sélection produit une carte différente — c'est l'intérêt de l'outil.

## Décorations optionnelles

| Décoration         | Contenu                                                           |
| ------------------ | ----------------------------------------------------------------- |
| Cartouche de titre | Titre libre, en police serif, encadré dans un coin                |
| Rose des vents     | Orientation nord en haut (projection équirectangulaire)           |
| Échelle            | Barre graduée en kilomètres, calculée depuis le rayon planétaire  |
| Date de campagne   | « Jour t après le Cataclysme »                                    |
| Bordure            | Filet d'encre double autour de l'image                            |
| Lignes de faille   | Trait aux coupures ; décoché par défaut pour une carte « propre » |

Toutes se proportionnent à la plus petite dimension de l'image. Le cartouche n'apparaît que si un titre est
saisi.

L'échelle utilise `radiusKm` : un degré de latitude vaut `π · R / 180` km, un degré de longitude à la latitude
φ vaut `π · R · cos φ / 180` km. La barre est calibrée sur la latitude médiane du rectangle et n'est donc
strictement exacte qu'en son milieu — le fait est assumé, la projection est équirectangulaire. Voir
[le temps et les anneaux](temps.md) pour les conversions degrés/kilomètres.

## Brouillard de guerre

La couche `fog` est un raster `Uint8` **basse résolution** (de l'ordre de 512×256) en **référentiel local**,
comme tout ce que le MJ édite. C'est la propriété essentielle : la zone explorée est attachée au terrain, donc
quand un anneau tourne, la région révélée part avec lui. Ce que les joueurs ont vu reste ce qu'ils ont vu, où
que la rotation l'emmène.

- `0` = inconnu, `255` = entièrement révélé.
- Les valeurs intermédiaires sont conservées volontairement : un `Uint8` plutôt qu'un masque binaire permet
  des bords adoucis et un pinceau progressif, et évite l'effet d'escalier qu'un masque 1 bit donnerait à cette
  résolution.
- Pinceau **révéler / cacher** (outil Brouillard) : même géométrie que les autres pinceaux (rayon, force,
  atténuation), même chaîne de conversion écran → `lonLocal` et même passage par une commande undo/redo —
  voir [l'éditeur](editeur.md). `révéler` pousse vers 255, `cacher` vers 0, d'une fraction `force · poids`
  du chemin restant à chaque pas, arrondie vers la cible pour qu'un passage léger finisse par l'atteindre.
  Le rayon est en cellules de brouillard, affiché en kilomètres à l'équateur.
- Boutons **Tout révéler** et **Tout cacher** : une commande chacun, sur toute la planète.
- Un monde neuf ou régénéré part entièrement inconnu (`0` partout).

## Rendu du brouillard

- **Dans l'éditeur** : surimpression translucide. Le MJ voit toujours le monde entier ; les zones non révélées
  sont voilées de sépia. Le voile n'apparaît que sous l'outil Brouillard, sauf si le MJ coche « Garder le
  voile avec les autres outils ». Détails de rendu dans [le rendu](rendu.md).
- **À l'export** : les zones non révélées sont **remplacées** par le fond parchemin vierge, avec la mention
  « Terra incognita » placée dans les grandes plages inconnues. Le calque de brouillard passe en mode
  `export`, opaque, au-dessus de toutes les couches. La mention va au point le plus éloigné de tout connu
  (transformée de distance sur une grille d'environ 96 cases, bord de l'image compté comme connu), et
  seulement si ce point est à plus d'un sixième de la petite dimension de l'image. Rien de ce qui s'y trouve n'est dessiné — ni
  relief, ni rivières, ni lieux, ni libellés — car l'image part chez les joueurs et ne doit rien laisser
  filtrer.
- Le bord est **adouci** : la valeur `fog`, échantillonnée en interpolation bilinéaire puis floutée sur
  quelques pixels de l'image finale, sert de facteur de fondu entre la carte et le parchemin. Cela évite
  l'effet de découpe rectangulaire dû à la basse résolution du masque et donne une frange irrégulière, dans
  l'esprit d'une carte dessinée à la main.

## Flux type

1. Régler la **date de campagne** à la date de la séance.
2. **Cadrer** la zone : rectangle de sélection, largeur de sortie.
3. **Vérifier l'aperçu du brouillard** : est-ce que ce qui est révélé correspond à ce que les joueurs savent ?
   Ajuster au pinceau si la séance précédente a fait découvrir une vallée.
4. **Exporter** le PNG, avec ou sans décorations.
5. **Partager** l'image aux joueurs par le canal de son choix.

## Export purement client

L'export ne fait **aucun appel réseau**. Le PNG est produit dans le navigateur, encapsulé dans un `Blob`, puis
proposé au téléchargement via une URL d'objet révoquée aussitôt après. Aucune image, aucun monde, aucune note
de MJ ne quitte la machine : l'application est un site statique sans backend, et le partage reste sous le
contrôle exclusif du MJ.

## Points ouverts

- **Plusieurs masques de brouillard** : un jeu de `fog` par groupe de joueurs ou par campagne, sélectionnable
  à l'export ; implique de généraliser `fog` en collection nommée dans le format de fichier.
- **Export vectoriel** (PDF ou SVG) pour l'impression grand format : demande de reconstruire le rendu hors du
  shader, donc un deuxième moteur de dessin — coût élevé, valeur à confirmer.
- **Lien de partage en lecture seule** : incompatible en l'état avec l'absence de backend ; piste d'un fichier
  `.pangee` allégé et d'une visionneuse statique, ou d'un hébergement tiers choisi par le MJ.

# Rendu

`src/render/` contient l'application PixiJS v8, le shader de terrain, les symboles, les libellés et l'export PNG. Aucune logique métier : le rendu lit le store et les textures produites par les workers, il ne calcule ni hydrologie ni biomes.

## Vue d'ensemble

Le pipeline empile, du fond vers la surface :

| Couche                                          | Technique                                                       | Source                                                               |
| ----------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Terrain (relief, mer, biomes, hachures de côte) | Un quad plein écran, un shader GLSL custom                      | Textures `height`, `biomeOverride`, `waterLevel`, `flowAcc`, `biome` |
| Rivières et lacs                                | Tracés à l'encre, largeur variable                              | `flowAcc`, `flowDir`, `lakeId`                                       |
| Symboles (montagnes, collines, forêts, marais)  | Sprites instanciés depuis un atlas SVG                          | `height`, `biome`                                                    |
| Routes                                          | Polylignes pleines ou pointillées                               | `Road[]`                                                             |
| Lieux et libellés                               | Icônes + texte serif                                            | `Place[]`                                                            |
| Décorations                                     | Ligne de faille, cartouche, rose des vents, échelle, brouillard | Config et masque `fog`                                               |

## Référentiels et textures : le point central

Deux familles de textures cohabitent, et la différence structure tout le shader.

**Textures en référentiel local**, éditées par le MJ, jamais recalculées par le temps : `height` (R32F) et `biomeOverride` (R8UI). Elles sont uploadées avec `wrapS = REPEAT` (wrap est-ouest) et `wrapT = CLAMP_TO_EDGE`. Le décalage de chaque anneau à la date t est passé en **uniforme**, en unités de texture :

```ts
// Δλ_r(t) = ω_r · (t − t0) mod 360  →  fraction de tour
const uRingOffset = RING_ORDER.map((r) => mod360(rings[r].omegaDegPerDay * (t - t0)) / 360);
```

Conséquences, et c'est la raison du choix :

- le décalage est **exact au flottant**, pas arrondi à la cellule : pas de tremblement ni de bande d'une cellule aux frontières ;
- **aucun assemblage CPU** n'est nécessaire pour afficher le monde à une nouvelle date — changer la date ne coûte qu'un uniforme, donc le scrub de date est instantané même pendant que l'hydrologie recalcule en arrière-plan ;
- le **pan est gratuit** : le wrap est-ouest est assuré par `REPEAT` et un `fract` sur la coordonnée x.

Le relief est téléversé en **`r32float`** : des mètres réels, pas une valeur normalisée. WebGL2 n'interpole pas nativement les textures flottantes (il faudrait `OES_texture_float_linear`), la texture est donc échantillonnée en `nearest` et **l'interpolation bilinéaire est faite à la main dans le shader**, sur quatre taps, avec le wrap en x appliqué à chaque tap pour que le filtrage reste correct au méridien ±180.

**Textures en référentiel monde**, produites par le worker d'hydrologie pour la date t : `waterLevel`, `flowAcc`, `flowDir`, `lakeId`, `biome`. Elles sont déjà assemblées, donc échantillonnées **sans décalage**. Elles arrivent avec un temps de retard (debounce, voir [hydrologie](hydrologie.md)) ; le terrain glisse d'abord, l'eau suit.

Le choix de l'anneau se fait **par fragment, depuis sa latitude**, comparée à `cutNorthLat` / `cutSouthLat` passées en uniformes et converties dans l'espace de texture. La frontière tombe donc exactement à la latitude de coupure, au pixel près, quel que soit le zoom — et non sur une limite de cellule du raster.

## Extrait GLSL (illustratif)

```glsl
uniform sampler2D uHeight;     // référentiel local, wrapS = REPEAT
uniform sampler2D uWaterLevel; // référentiel monde, déjà assemblé
uniform vec3  uRingOffset;     // [nord, équateur, sud], en tours (unités de texture)
uniform vec2  uCutV;           // v des coupures nord / sud, même orientation que uHeight

in  vec2 vWorldUv;             // coordonnée monde du fragment : u = lon, v = lat
out vec4 fragColor;

float ringOffset(float v) {
  float north = step(uCutV.x, v);            // v > cutNorth
  float south = step(v, uCutV.y);            // v < cutSouth
  float mid   = 1.0 - north - south;
  return north * uRingOffset.x + mid * uRingOffset.y + south * uRingOffset.z;
}

void main() {
  float du = ringOffset(vWorldUv.y);
  vec2  uvLocal = vec2(fract(vWorldUv.x - du), vWorldUv.y);

  float h     = texture(uHeight, uvLocal).r;      // local : décalé
  float water = texture(uWaterLevel, vWorldUv).r; // monde : non décalé

  fragColor = shadeTerrain(h, water, vWorldUv);
}
```

Le `step` évite une divergence de branche sur le quad. En pratique le shader échantillonne aussi `biomeOverride` en local, `biome` et `flowAcc` en monde, applique l'ombrage de relief (gradient de `h` en différences finies, en tenant compte du wrap), les hachures de côte et le grain de parchemin.

### Le retard des couches dérivées

Relief assemblé, eau, biomes, réseau hydrographique : tout ce qui vit en référentiel monde est
calculé pour une date, et n'arrive qu'après que le curseur a bougé. Les afficher tels quels les
laisse en arrière du continent — la mer reste immobile pendant que la terre glisse, les rivières
quittent leurs vallées, les montagnes se posent sur un relief périmé — puis la carte saute quand le
calcul arrive.

Chaque couche est donc **datée**, et sa lecture décalée de ce que son anneau a parcouru depuis. Le
rattrapage est **exact**, non approché : le monde local, lui, n'a pas bougé, si bien que lire la
couche à la position qu'elle occupait alors redonne rigoureusement le bon morceau de terrain. Le
calcul suivant ne corrige plus que la forme de l'eau.

La règle vit dans `src/render/worldLag.ts`, testée, et sert au semis des symboles comme au tracé des
rivières ; le shader la recopie en GLSL sous la forme d'un `uWaterRingOffsetDeg` en regard de
`uRingOffsetDeg`.

### Quelle eau recouvre une cellule

La surface d'eau retenue est la **plus haute** du niveau de la mer et du plan d'eau calculé par
l'hydrologie. Le niveau de la mer est un réglage, connu à l'instant où le MJ le change ; le plan
d'eau, lui, arrive après coup et n'apporte que les lacs et les mers intérieures.

S'en remettre au seul plan d'eau faisait attendre un recalcul pour voir la mer monter : en relevant
le niveau, les terres basses pâlissaient — leur altitude relative devenait nulle — sans jamais
passer au bleu.

Contrepartie assumée : une cuvette fermée dont le plan d'eau est plus bas que la mer est rendue au
niveau de la mer. Elle est noyée de toute façon, et l'écart ne se voit pas à cette échelle.

La règle vaut pour le shader **et** pour le semis des symboles, sans quoi des arbres flotteraient
sur la mer. Elle vit donc en clair dans `src/render/waterSurface.ts`, testée, et le GLSL la recopie.

### Ce que coûtent les symboles

Deux à trois mille figures à rastériser à chaque image, pour un semis qui ne change qu'aux paliers
de zoom. Mesuré : carte immobile, elles emportaient près d'un quart de la fluidité.

La couche est donc **figée en une texture**, reconstruite aux mêmes moments que le semis lui-même.
La résolution doit être celle de l'écran et non celle du repère local, où les figures mesurent des
fractions de degré : sans cela le cache les réduit à quelques pixels flous avant de les réétirer —
c'est visible du premier coup d'œil.

Deux mesures ont guidé ce choix plutôt que l'intuition. Construire les tracés ne coûte que deux
millisecondes : ce n'était pas là qu'il fallait chercher. Et regrouper les symboles par passes de
style — un seul trait pour tous les contours au lieu d'un par figure — n'a rien changé de
mesurable, même si cela reste plus sain ; c'est le cache qui a tout apporté.

Le pas de parcours progressant par puissances de deux, la grille est jusqu'à deux fois trop serrée
entre deux paliers. Une part des points est donc écartée par un tirage stable, ce qui maintient un
espacement constant à l'écran : sans cela la carte se couvrait de montagnes à mesure qu'on zoomait.

### Des courbes tracées à la main

Les symboles sont dessinés en degrés, dans un conteneur mis à l'échelle du zoom. PixiJS décide de
la finesse d'une courbe d'après ses coordonnées locales — ici de l'ordre du centième de degré — et
l'approche alors par deux ou trois segments droits : les collines sortaient en crochets anguleux
plutôt qu'en dos arrondis.

Les courbes de ce dossier sont donc échantillonnées à la main, avec un nombre de points fixe. Les
icônes de lieux échappent à la règle : elles sont tracées en pixels écran, où PixiJS mesure
correctement.

### Un semis qui ne bouge pas

Les symboles étaient semés sur une grille dont le pas se déduisait du zoom. Chaque cran de molette
changeait donc la grille, et avec elle la position de **toutes** les montagnes : la carte semblait
se régénérer sous les yeux, ce qui est insupportable à l'usage.

La grille est désormais fixe, ancrée au monde, avec un pas très fin. C'est le **pas de parcours**
qui s'ajuste au zoom, et toujours par puissances de deux. En zoomant il est divisé par deux : les
points déjà affichés le restent — un multiple de huit est un multiple de quatre — et de nouveaux
s'intercalent entre eux. Un symbole n'est jamais déplacé, il apparaît ou disparaît.

Cette grille est en **référentiel local**, et non en référentiel monde : un symbole reste accroché
à son morceau de terrain et glisse avec son anneau, comme une ville. L'ancrer au monde laissait le
relief défiler sous un semis immobile — un point posé sur un sommet se retrouvait en plaine, et les
montagnes semblaient changer de forme sur place à mesure que le continent passait.

Le coût ne dépend pas de la finesse de la grille : le pas compense, de sorte que le nombre de
points visités reste proportionnel à la surface de l'écran.

Deux détails qui comptent. Le pas de la grille fine doit rester sous l'espacement visé au zoom
maximal, sans quoi les symboles s'écartent au lieu de se resserrer. Et le décalage aléatoire d'un
point suit l'espacement auquel il **apparaît**, non le zoom courant : large pour un sommet visible
de loin, serré pour un détail qui ne sort qu'au zoom — sinon il sauterait d'un niveau à l'autre.
Il occupe presque toute sa case, faute de quoi l'œil retrouve les rangées de la grille dans les
forêts.

### Distinguer les lacs de la mer

Lacs et mer partageaient la même palette et le même trait de rive. Le monde en comptait deux mille
et on n'en distinguait aucun : une eau intérieure prenait exactement la teinte d'une eau côtière.

Les eaux douces ont donc leur propre rendu — plus clair, étalé sur quelques centaines de mètres de
profondeur au lieu des grands fonds, avec un trait de rive plus léger et sans hachures
bathymétriques, qui sont une convention marine.

Un plan d'eau perché au-dessus du niveau marin est réputé doux. Les rares cuvettes fermées plus
basses que la mer passent pour marines : l'écart ne se voit pas à cette échelle, et cela évite de
transporter une couche de plus jusqu'au shader. La règle est dans
`src/render/waterSurface.ts`, testée, et le GLSL la recopie.

### Ne pas libérer une texture encore liée

Les couches d'eau changent à chaque calcul. Les remplacer par de nouvelles textures, puis détruire
les anciennes, laisse le groupe de liaison du shader pointer sur des sources mortes : PixiJS
avertit, et selon le pilote le terrain cesse purement et simplement d'être dessiné — le rendu
logiciel des tests le tolérait, un vrai GPU beaucoup moins.

À taille égale, le contenu des textures est donc **réécrit en place** plutôt que remplacé : rien
n'est réalloué, et le shader garde ses références. Quand la taille change — au premier téléversement,
la texture d'attente d'un seul texel devenant la vraie couche — les anciennes sont mises de côté et
libérées seulement après le rendu suivant, qui a reconstruit la liaison.

Il subsiste le même avertissement au démontage du moteur, `app.destroy` ne libérant pas le shader
qui référence encore les textures. Il est sans conséquence, tout étant détruit dans la foulée.

### Redessiner quand les données changent

PixiJS ne redessine que si la scène a changé. Remplacer une texture ou écrire un uniforme ne l'en
informe pas : l'image restait figée jusqu'au prochain mouvement de caméra, qui la salissait par
effet de bord. Toute mise à jour de données demande donc explicitement un rendu. Un test de bout en
bout verrouille ce point : après un changement de date, un déplacement d'un pixel aller-retour ne
doit rien changer à l'image.

## Caméra

- Pan et zoom continus (molette, drag, pinch), zoom centré sur le curseur.
- **Wrap infini est-ouest** : la coordonnée de caméra est prise modulo un tour de planète ; le quad de terrain gère la répétition via `fract`, et les couches vectorielles sont dessinées jusqu'à trois fois (offset −1, 0, +1 tour) selon la largeur visible.
- **Clamp nord-sud** : la latitude de la caméra est bornée pour que les pôles ne sortent pas de l'écran vers l'intérieur.
- Conversions `écran ↔ monde ↔ local` : une seule implémentation, dans `src/model/`, utilisée par le rendu et par les outils. Tout outil convertit en `lonLocal` avant d'écrire ([éditeur](editeur.md)).

## Style « carte de livre »

- **Fond** : parchemin (texture tuilable + grain procédural + vignette), appliqué sous l'eau et sous la terre pour unifier la matière.
- **Côtes** : trait d'encre à l'isoligne `h = waterLevel`, plus des **hachures parallèles générées dans le shader** à partir de la distance signée au trait de côte (3 à 5 traits décroissants, phase déterminée par un bruit pour éviter la régularité mécanique).
- **Reliefs et végétation** : **symboles SVG dessinés à la main**, jamais du bruit coloré. Montagnes et collines placées sur les crêtes détectées dans `height`, forêts et marais selon `biome`. Placement par grille de cellules avec **jitter déterministe** (PRNG semé par l'index de cellule) pour casser l'alignement, et **LOD** sur 3–4 niveaux de zoom : densité et taille des symboles changent, les plus petits disparaissent en vue large.
- **Rivières** : trait d'encre, largeur ∝ √`flowAcc`, méandres ajoutés par bruit le long du tracé ; lacs en aplat avec un liseré plus sombre.
- **Routes** : `road` en trait plein, `path` en pointillé fin, `sea-route` en pointillé long et clair.
- **Lieux** : icône par `kind`, taille par `size`, libellé en police serif sous licence OFL **auto-hébergée** (pas de CDN, le site doit fonctionner hors ligne).

## Palette

Palette volontairement limitée, exposée comme jeu de tokens (CSS custom properties côté UI, constantes GLSL côté shader) pour éviter le rendu « plastique ». Valeurs indicatives, à figer en phase 3 :

| Token             | Rôle                              | Indicatif |
| ----------------- | --------------------------------- | --------- |
| `ink`             | Traits, côtes, rivières, libellés | `#2b2119` |
| `ink-soft`        | Hachures, ombrage léger           | `#6b5b4a` |
| `parchment`       | Fond de carte                     | `#e9dcbe` |
| `parchment-shade` | Vignette, bords                   | `#cdba94` |
| `sea-shallow`     | Plateau continental               | `#a9bcc2` |
| `sea-deep`        | Grands fonds                      | `#6f8794` |
| `land-low`        | Plaines                           | `#c9c39a` |
| `land-high`       | Plateaux, montagnes               | `#b39d78` |
| `forest`          | Vert éteint                       | `#7d8b6a` |

Aucune couleur saturée, aucun dégradé long : les variations viennent des symboles et des hachures, pas de la couleur.

## Anti-collision des libellés

Passe gloutonne à chaque changement de vue (ou de date) :

1. Tri par priorité : `size` décroissante, puis `kind` (`city` > `fortress` > `town` > `ruin` > `village` > `volcano` > `landmark`).
2. **Budget de labels par niveau de zoom** : un plafond fixe évite la bouillie en vue large.
3. Placement en **couronne** autour du point (8 positions candidates : droite, gauche, haut, bas, diagonales), première position libre retenue.
4. Aucune position libre → le libellé est **supprimé**, jamais chevauché. L'icône, elle, reste.

Le test de collision se fait sur des rectangles en espace écran, indexés dans une grille uniforme.

## Ligne de faille

Aux deux coupures, un trait de faille discret (encre, léger tremblement procédural) dessiné **en référentiel monde**, donc à latitude fixe quelle que soit la date. Masquable depuis l'UI ; masqué par défaut à l'export si le MJ veut une carte « propre ». Les escarpements et cascades détectés par l'hydrologie s'y greffent comme symboles.

## Brouillard de guerre

Un second quad plein écran, `src/render/fogLayer.ts`, posé **au-dessus de toutes les couches** — symboles,
rivières, routes et libellés compris. Il partage le `UniformGroup` du terrain (caméra, décalages d'anneaux,
coupures) : il ne peut donc pas se désaligner du relief, et le masque, stocké en référentiel local, glisse avec
son anneau. Trois modes : `off`, `preview` (voile sépia à 55 % d'opacité, sous l'outil brouillard ou à la
demande du MJ) et `export` (parchemin opaque, voir [le partage](partage.md)).

| Point         | Choix                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| Texture       | `r8unorm`, 256×128 pour un relief 2048×1024, `nearest`                                   |
| Interpolation | bilinéaire à la main dans le shader, wrap en x compris, comme le relief                  |
| Bord          | `smoothstep(0.25, 0.75, fog + bruit)`, bruit de 0,6 cellule par cellule de brouillard    |
| Mise à jour   | réécriture en place au fil du pinceau ; renvoi complet après annulation ou nouveau monde |

Un bruit de frange plus fin que la cellule de brouillard mouchetait le bord en vue d'ensemble au lieu de le
faire onduler. À la coupure, l'interpolation mélange sur une cellule de brouillard deux lignes voisines en
référentiel local : la frange peut y déborder d'une cellule, ce qui ne se voit pas.

## Performance

Cible : 60 fps en 1080p.

- **Un seul draw call pour le terrain** : tout le shading est dans le quad, pas de couche raster empilée.
- **Symboles instanciés** depuis un atlas de textures unique, un draw call par type de symbole au maximum.
- **Atlas** pour les icônes de lieux et les motifs ; polices en WOFF2 auto-hébergées.
- **Mise à jour partielle des textures** pendant l'édition : le pinceau relief écrit un rectangle dans `height` et le pousse via `texSubImage2D` sur la zone touchée seulement, sans réupload complet des 2048×1024 valeurs.
- Changement de date = mise à jour de trois flottants d'uniforme. Les textures monde ne sont réuploadées qu'à la fin du recalcul hydrologique.

## Animations (phase 6)

Pixi rend déjà chaque image : animer revient à faire avancer une **horloge** (`uTimeS`, en secondes) dans le
ticker avant le rendu. Rien n'est reconstruit d'une image à l'autre. Réglage « Animer l'eau, les volcans et
les créatures », non enregistré, coupé d'office si le système demande de réduire les mouvements
(`prefers-reduced-motion`). Coupée, l'horloge revient à zéro et la carte est exactement l'image fixe d'avant.
Les tests de bout en bout tournent en `reducedMotion: 'reduce'`, sans quoi leurs comparaisons d'images au
pixel près n'auraient pas de sens ; ceux qui vérifient l'animation le rétablissent.

| Effet                | Où                            | Principe                                                                                            |
| -------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Houle                | shader terrain                | les isolignes des hachures ondulent, chacune à sa phase tirée d'un bruit                            |
| Vagues               | shader terrain                | traits clairs tous les 45 m de profondeur, qui glissent vers le rivage, sous 140 m d'eau            |
| Reflets des lacs     | shader terrain                | bruit qui dérive lentement à la surface                                                             |
| Courant des rivières | `src/render/riverFlow.ts`     | un quad par segment, portant sa distance à la source ; tirets clairs qui filent vers l'aval         |
| Volcans              | `src/render/volcanoLayer.ts`  | lueur qui palpite et six bouffées qui montent, grossissent, dérivent vers l'est et s'effacent       |
| Créatures            | `src/render/creatureLayer.ts` | silhouettes à l'encre, posées le long de la trajectoire par `creaturePose` ; ailes et houle battent |

Les volcans sont les lieux de `kind === 'volcano'`, posés par la génération ou par le MJ. Leur calque passe
au-dessus des icônes mais **sous le brouillard** : à l'export, un volcan inconnu ne se trahit pas par sa
fumée. Chacun a sa phase, tirée de son identifiant, pour ne pas fumer en cadence.

Les créatures sont tracées en pixels écran, comme les icônes de lieux, et orientées selon leur cap — le navire
reste debout et se retourne seulement. Sans animation, chacune attend à son premier point : la carte reste
une image fixe. Leur calque passe sous le brouillard, et leurs trajectoires, repères d'édition, sont retirées
de l'export.

Le courant est un mesh à shader propre plutôt qu'un tracé redessiné : la géométrie n'est reconstruite qu'avec
le réseau ou la date, la largeur est tenue en pixels par un uniforme de zoom, et défiler ne coûte qu'un
uniforme. Les rivières de moins d'un pixel de reflet n'en portent pas.

Restent à faire, décrits ici pour mémoire :

- **Cascades** : voile blanc au franchissement d'une coupure, dès que l'hydrologie les détectera.

Le **time-lapse** est décrit dans [le temps](temps.md).

## Points ouverts

- **Globe 3D** en vue d'ensemble (phase 7) : réutiliserait les mêmes textures locales et les mêmes uniformes de décalage, avec une projection sphérique. Non décidé.
- **Rendu de la mer aux frontières d'anneaux** : surface plane sans traitement particulier en v1. À confirmer — voir [décisions](decisions.md).
- Micro-détail procédural au zoom très rapproché (bruit dans le shader) : principe acté, paramètres à régler en phase 3.

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

## Performance

Cible : 60 fps en 1080p.

- **Un seul draw call pour le terrain** : tout le shading est dans le quad, pas de couche raster empilée.
- **Symboles instanciés** depuis un atlas de textures unique, un draw call par type de symbole au maximum.
- **Atlas** pour les icônes de lieux et les motifs ; polices en WOFF2 auto-hébergées.
- **Mise à jour partielle des textures** pendant l'édition : le pinceau relief écrit un rectangle dans `height` et le pousse via `texSubImage2D` sur la zone touchée seulement, sans réupload complet des 2048×1024 valeurs.
- Changement de date = mise à jour de trois flottants d'uniforme. Les textures monde ne sont réuploadées qu'à la fin du recalcul hydrologique.

## Animations (phase 6)

Décrites ici pour mémoire, implémentées après le cœur fonctionnel :

- **Eau** : défilement d'un bruit le long de `flowDir` pour les rivières, ondulation aux côtes, voile blanc aux cascades — entièrement dans le shader, coût quasi nul (un uniforme de temps).
- **Volcans** : `Place.kind === 'volcano'` alimente un émetteur de particules (fumée, lueur).
- **Créatures** : sprites suivant des trajectoires à points de passage, vitesse réglable ; purement décoratif.
- **Time-lapse** : lecture de la date à vitesse réglable, avec l'**hydrologie précalculée par images-clés** et interpolée entre deux clés ; le terrain, lui, suit la date en continu.

## Points ouverts

- **Globe 3D** en vue d'ensemble (phase 7) : réutiliserait les mêmes textures locales et les mêmes uniformes de décalage, avec une projection sphérique. Non décidé.
- **Rendu de la mer aux frontières d'anneaux** : surface plane sans traitement particulier en v1. À confirmer — voir [décisions](decisions.md).
- Micro-détail procédural au zoom très rapproché (bruit dans le shader) : principe acté, paramètres à régler en phase 3.

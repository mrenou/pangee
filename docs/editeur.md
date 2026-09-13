# Éditeur

Code : `src/edit/`. Cette page décrit les outils d'édition du MJ et la pile d'annulation.
Prérequis : [le modèle du monde](modele-monde.md) et [le temps et les anneaux](temps.md).

## Principe fondateur

**Toute écriture cible le référentiel local et passe par une commande undo/redo.** Le référentiel monde
n'existe que pour l'affichage ([le rendu](rendu.md)) et les couches dérivées ([l'hydrologie](hydrologie.md)) ;
aucun outil n'y écrit jamais. C'est cette règle qui garantit qu'un monde édité à une date quelconque reste
cohérent à toutes les autres dates.

### Chaîne de conversion

| Étape               | Entrée                       | Sortie                          |
| ------------------- | ---------------------------- | ------------------------------- |
| 1. Caméra           | point écran, en pixels       | `(lonWorld, lat)`               |
| 2. `ringOf(lat)`    | `lat`, `RingConfig`          | `RingId`                        |
| 3. Décalage inverse | `lonWorld`, anneau, date `t` | `lonLocal = lonWorld − Δλ_r(t)` |
| 4. Indexation       | `(lonLocal, lat)`            | `x`, `y`, index `y * width + x` |

```ts
function screenToLocal(p: ScreenPoint, cam: Camera, cfg: RingConfig, t: number): LocalPoint {
  const { lonWorld, lat } = cam.screenToWorld(p);
  const ringId = ringOf(lat, cfg);
  // Δλ_r(t) = ω_r · (t − t0) mod 360
  const lonLocal = wrapLon(lonWorld - deltaLon(cfg, ringId, t));
  return { ringId, lonLocal, lat };
}
```

`wrapLon` ramène dans `[−180, 180[` ; `x` est calculé modulo `width` (wrap est-ouest), `y` est borné aux pôles.

### Conséquence

À une date `t ≠ t0`, le pinceau « suit » la bande qui glisse : le curseur vise une montagne à l'écran, la
conversion retrouve la cellule locale de cette montagne quelle que soit la rotation appliquée. La même
retouche faite à `t = 0` ou à `t = 900` produit exactement le même contenu local, donc l'édition reste
valable quelle que soit la date. Corollaire : un geste qui franchit une latitude de coupure change d'anneau
en cours de route, donc de décalage ; chaque échantillon du geste est converti indépendamment. Le trait est
continu à l'écran et discontinu dans le raster local — c'est le comportement voulu.

## Pinceau relief

Écrit dans `height` (Float32, mètres, négatif = sous la mer).

| Mode      | Effet sur une cellule de poids `w`               | Paramètre propre                                                |
| --------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `raise`   | `h += strength · w`                              | —                                                               |
| `lower`   | `h −= strength · w`                              | —                                                               |
| `smooth`  | `h += (moyenne du voisinage − h) · strength · w` | rayon du noyau                                                  |
| `flatten` | `h += (targetM − h) · strength · w`              | `targetM`, altitude cible (par défaut prélevée au premier clic) |

Paramètres communs : `radius` (en cellules, affiché aussi en kilomètres via le rayon planétaire), `strength`,
`falloff` (atténuation radiale `w = f(d / radius)`, du bord dur au très doux).

Le disque du pinceau est parcouru en coordonnées locales avec wrap en x ; à chaque déplacement, la bbox
touchée est accumulée. Deux effets de bord :

- **GPU** : la texture `height` reçoit une mise à jour partielle (`texSubImage2D` sur la bbox du pas courant),
  jamais un réupload complet — voir [le rendu](rendu.md).
- **Hydrologie** : le recalcul est debounced à 150 ms après le dernier mouvement et exécuté dans le worker.
  Le terrain bouge immédiatement, l'eau suit — voir [l'hydrologie](hydrologie.md).

## Pinceau biome

Écrit dans `biomeOverride` (Uint8). Le MJ choisit un biome dans la palette ; la gomme écrit `0`, c'est-à-dire
le retour au biome automatique calculé par le climat. Pas de fondu : la valeur est posée pleine sur toutes les
cellules du disque, l'adoucissement visuel est l'affaire du rendu.

## Lieux

Poser (clic), déplacer (glisser), renommer en ligne, éditer `kind`, `size`, icône et `notes`. `ringId` n'est
jamais choisi par l'utilisateur : il est déduit par `ringOf(lat)` au moment où le lieu est posé, et recalculé
à chaque déplacement. Un lieu appartient à un seul anneau. Une ville à cheval sur une coupure se modélise par
deux `Place` (un par côté) et, en v1.1, une emprise `urban` peinte des deux côtés.

## Routes

Tracé point à point (clic pour ajouter un point, double-clic ou `Échap` pour terminer), magnétisme sur les
lieux situés à quelques pixels écran : le point est alors calé exactement sur la position du lieu. Fermeture
possible pour une boucle.

**Scission automatique aux coupures, à la création.** Dès qu'un segment `[A, B]` franchit `cutNorthLat` ou
`cutSouthLat`, un point est inséré exactement à la latitude de coupure (interpolation le long du segment, wrap
en longitude pris en compte), puis la polyligne est découpée en deux `Road` distincts portant chacun le
`ringId` de leur côté. Rien n'est recalculé ensuite : à `t ≠ t0` les deux moitiés divergent et la route
apparaît coupée à la faille.

Option **suivre le relief** : un A* sur la grille locale entre les deux derniers points, coût fonction de la
pente et pénalité sur l'eau, propose un tracé de moindre coût que le MJ accepte ou rejette. Le résultat est
une polyligne ordinaire, éditable comme les autres.

## Réglages

Panneau monde : vitesse signée et sens par anneau (`omegaDegPerDay`, préréglage « immobile »), `cutNorthLat`
et `cutSouthLat` avec l'invariant `cutSouthLat < cutNorthLat` vérifié à la saisie, date de campagne, `t0`,
rayon planétaire, niveau de la mer. Aucun de ces réglages ne modifie une donnée locale : ils changent la
fonction du temps et les couches dérivées. Voir [le temps et les anneaux](temps.md).

## Undo / redo

Pile de commandes ; chaque commande porte `apply` et `revert` et connaît son coût mémoire.

```ts
interface RasterPatch {
  layer: 'height' | 'biomeOverride' | 'fog' | 'urban';
  x: number;
  y: number;
  w: number;
  h: number; // bbox en cellules locales, wrap en x autorisé
  before: Float32Array | Uint8Array; // w · h valeurs, ligne par ligne
  after: Float32Array | Uint8Array;
}

interface Command {
  readonly label: string;
  readonly bytes: number;
  apply(state: WorldState): void;
  revert(state: WorldState): void;
  /** fusionne les pas d'un même geste en une seule entrée de pile */
  coalesceWith?(next: Command): Command | null;
}
```

Règles :

- **Patchs rectangulaires** : pour les rasters on ne stocke jamais la couche entière, seulement la bbox
  touchée et son contenu avant/après.
- **Coalescence** : tous les pas d'un même geste (`mousedown` → `mouseup`) fusionnent en une commande unique,
  dont la bbox est l'union des bboxes et le `before` celui du tout premier pas. Un `Ctrl+Z` annule le trait,
  pas un pas de souris.
- **Pile bornée** : profondeur maximale et budget mémoire ; les commandes les plus anciennes sont évincées
  quand le budget est dépassé.
- Les objets vectoriels utilisent des commandes légères (ajout, suppression, modification d'un champ), sans
  patch raster.

## Régénération

Relancer la génération procédurale **écrase** `height`, `biomeOverride` et les objets générés. Si le monde a
reçu au moins une commande d'édition, une confirmation explicite est demandée (« ce monde a été édité, la
régénération effacera ces modifications »). La régénération vide la pile d'undo. Voir
[la génération](generation.md).

## Points ouverts

- Édition de la couche `urban` (v1.1) : pinceau d'emprise, lien avec les `Place` d'une ville coupée,
  convention de nommage des deux moitiés.
- Multi-sélection d'objets vectoriels : déplacement et suppression groupés en une commande unique.
- Calques : masquer ou verrouiller une couche pendant l'édition, et éventuellement un jeu d'annotations MJ
  distinct des couches du monde.

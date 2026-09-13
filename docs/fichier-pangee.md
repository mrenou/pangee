# Format de fichier `.pangee`

Un monde s'échange dans un fichier `.pangee` unique : une **archive zip** produite et relue avec `fflate`
(`zipSync` / `unzipSync`, ou leurs variantes asynchrones dans un worker pour les gros mondes). Le format
sérialise exactement l'état canonique décrit dans [le modèle du monde](modele-monde.md) : tout y est en
**référentiel local**, rien n'est stocké en référentiel monde puisque celui-ci se recalcule à partir de la
date.

## Entrées de l'archive

| Entrée       | Type                                        | Taille en 2048×1024     | Rôle                                                                                                                 |
| ------------ | ------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `world.json` | JSON UTF-8                                  | 20–200 Kio              | Métadonnées, `RingConfig`, date de campagne, rayon, niveau de mer, dimensions des rasters, `Place[]`, `Road[]`, seed |
| `height.bin` | `Float32Array` (ou `Uint16Array` quantifié) | 8 Mio (4 Mio quantifié) | Altitude et bathymétrie, en mètres                                                                                   |
| `biome.bin`  | `Uint8Array`                                | 2 Mio                   | `biomeOverride` ; `0` = biome automatique                                                                            |
| `fog.bin`    | `Uint8Array` basse résolution               | ~128 Kio en 512×256     | Brouillard de guerre — voir [le partage](partage.md)                                                                 |

Les rasters couvrent la planète entière, sans marge, indexés `y * width + x`, ligne par ligne du nord
(`y = 0`, `lat = +90`) au sud. La compression deflate du zip réduit fortement `biome.bin` et `fog.bin`
(grandes plages constantes) et beaucoup moins `height.bin` en Float32, dont les bits de mantisse sont proches
du bruit : c'est l'argument principal en faveur de la quantification.

`urban.bin` (Uint8) s'ajoutera en v1.1 sur le même modèle, en entrée facultative.

## Schéma de `world.json`

```ts
interface WorldFile {
  formatVersion: number; // entier, voir « Versions et migrations »
  app: { name: 'pangee'; version: string };
  createdAt: string; // ISO 8601
  updatedAt: string;
  world: {
    id: string;
    name: string;
    seed: number; // seed de génération procédurale
    radiusKm: number; // défaut 6371
    seaLevelM: number;
    campaignDate: number; // date courante, en jours depuis le Cataclysme
  };
  rings: RingConfig; // cutNorthLat, cutSouthLat, rings[RingId].omegaDegPerDay, t0
  rasters: RasterIndex;
  places: Place[];
  roads: Road[];
}

interface RasterIndex {
  width: number; // 2048 ou 4096
  height: number; // 1024 ou 2048
  endianness: 'little';
  layers: {
    height: HeightLayer;
    biome: { file: 'biome.bin'; type: 'uint8' };
    fog: { file: 'fog.bin'; type: 'uint8'; width: number; height: number };
  };
}

type HeightLayer =
  | { file: 'height.bin'; type: 'float32' }
  | { file: 'height.bin'; type: 'uint16'; scaleM: number; offsetM: number };
// valeur réelle : h = raw * scaleM + offsetM
```

### Quantification du relief

Avec `type: 'uint16'`, une plage de −12 000 m à +9 000 m donne `scaleM ≈ 0,32` m, soit une précision très
inférieure au relief d'une cellule de ~20 km de côté, pour la moitié de la taille. Le Float32 reste possible
pour qui veut conserver l'exactitude bit à bit d'un monde généré. Le choix est enregistré par monde, pas
global : le lecteur se conforme à ce que dit `world.json`.

## Endianness

Les entrées binaires sont **little-endian**, explicitement, et le champ `rasters.endianness` le documente.
En écriture comme en lecture on peut passer par un `DataView` ; en pratique le code construit directement une
vue typée (`new Float32Array(buffer)`), ce qui suppose une machine little-endian — le cas de toutes les cibles
navigateur actuelles. Un fichier annonçant autre chose que `'little'` est refusé plutôt que lu de travers.

## Versions et migrations

`formatVersion` est un entier, incrémenté à chaque changement incompatible.

```ts
export const CURRENT_FORMAT_VERSION = 3;

type Migration = (file: unknown) => unknown;
const migrations: Record<number, Migration> = { 1: v1ToV2, 2: v2ToV3 };
```

- Fichier plus ancien : les migrations `v(n) → v(n+1)` sont **chaînées** jusqu'à la version courante. Chaque
  migration est une fonction pure, testée isolément.
- Fichier plus récent : **refus explicite**, avec un message clair (« ce monde a été enregistré par une
  version plus récente de Pangée : version de format N, cette application lit jusqu'à M »). Aucune tentative
  de lecture partielle.
- Tests Vitest sur des fichiers de référence : un `.pangee` minimal par version historique est conservé en
  fixture ; la suite vérifie que la chaîne de migrations produit l'état attendu et que le couple
  écriture/lecture est un aller-retour fidèle.

## Autosave et stockage local

- IndexedDB via `idb-keyval`, jamais `localStorage` : les `ArrayBuffer` y sont stockés nativement, sans
  encodage base64.
- **Plusieurs mondes**, indexés par `world.id`. Un index `worlds` liste `{ id, name, updatedAt }` pour
  l'écran de sélection ; le contenu est réparti en clés séparées (`world:<id>:meta`, `world:<id>:height`,
  `world:<id>:biome`, `world:<id>:fog`) afin qu'une frappe dans un champ de texte ne réécrive pas 8 Mio de
  relief.
- Sauvegarde **debounced** après édition (quelques secondes d'inactivité, ou à la fin d'un geste de pinceau) ;
  les rasters ne sont réécrits que si leur couche a effectivement changé.
- **Restauration au chargement de la page** : le dernier monde ouvert est rechargé automatiquement.
- Boutons explicites d'**export** (téléchargement d'un `.pangee`) et d'**import** (glisser-déposer ou
  sélecteur de fichier) — indépendants de l'autosave, qui n'est qu'un filet de sécurité.

## Robustesse à l'import

L'import valide la structure **avant** de toucher à l'état courant : présence des entrées attendues, cohérence
de `rasters.width × rasters.height` avec la taille des tampons, invariant `cutSouthLat < cutNorthLat`,
`RingId` connus, `ringId` de chaque `Place` et `Road` compatible avec sa latitude. Le parsing se fait aux
frontières du système, lève une erreur typée en cas d'échec, et ne produit un nouvel état que complet : il n'y
a jamais d'état à moitié chargé, l'ancien monde reste intact si l'import échoue. Voir
[les conventions](conventions.md).

## Points ouverts

- Compression du relief : Uint16 par défaut ou Float32 ? Encodage par différences avant deflate, découpage en
  tuiles, ou stockage d'une pyramide de niveaux de détail pour un chargement progressif.
- Versionnage et historique de mondes : instantanés datés dans IndexedDB, diff entre deux instantanés, budget
  disque et politique de purge.

# src/render

PixiJS v8 et GLSL. Affiche, ne décide de rien.

- **Aucune logique métier.** Si un calcul décide de l'état du monde, il appartient à `model`,
  `hydro` ou `climate`, pas ici.
- Distinction centrale : `height` et `biomeOverride` sont des textures en **référentiel local**,
  en `REPEAT` sur x, et le décalage de chaque anneau est un **uniforme** (`uRingOffsetDeg[8]`, du nord au sud) appliqué
  dans le fragment shader — décalage flottant exact, aucun assemblage CPU, terrain instantané au
  scrub de date. Les couches d'eau et de biome viennent du worker en **référentiel monde**.
- Le shader choisit l'anneau depuis la latitude du fragment, par comparaison avec les coupures
  passées en uniformes : la frontière est exacte au pixel près.
- Style carte de livre : palette limitée, symboles SVG dessinés main avec LOD et jitter
  déterministe, rivières à l'encre de largeur ∝ √`flowAcc`, libellés serif anti-collision.
- Performance : 60 fps en 1080p, un seul draw call pour le terrain, atlas et instanciation pour
  les symboles, `texSubImage2D` partiel pendant l'édition.

→ `docs/rendu.md`

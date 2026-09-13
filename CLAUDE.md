# Pangée

Outil web pour un MJ : une planète découpée par un Cataclysme en trois anneaux qui tournent, à
visualiser, régler dans le temps, sculpter et partager en PNG. Site statique, aucun backend.

```bash
npm run dev      # serveur Vite
npm run test     # Vitest
npm run build    # build de production
npm run lint     # ESLint + Prettier
```

## Dossiers

`model` types, anneaux, coordonnées, format `.pangee` · `gen` génération procédurale (worker) ·
`hydro` assemblage, priority-flood, D8, lacs (worker) · `climate` biomes · `render` PixiJS,
shader terrain, export PNG · `edit` outils et undo/redo · `ui` + `store` React et Zustand ·
`workers` points d'entrée Comlink.

## Règles

- **Lire `docs/<sujet>.md` avant de toucher à `src/<sujet>/`.** Index : `docs/README.md`.
- Les données sont stockées en **référentiel local** (le monde d'avant le Cataclysme) ; la carte à
  la date `t` est calculée, jamais accumulée. Voir `docs/modele-monde.md`.
- `model`, `gen`, `hydro`, `climate` sont **purs** : pas de DOM, Pixi, React ni Zustand.
- Rasters = typed arrays indexés `y * width + x`, zéro allocation en boucle chaude.
- L'unité et le référentiel sont dans le nom : `omegaDegPerDay`, `seaLevelM`, `lonLocal`.
- Toute décision structurante ajoute une entrée dans `docs/decisions.md`, dans le même commit.

# src/model

Types et fonctions pures du monde : coordonnées, anneaux, conversions, format `.pangee`.

- **Pur.** Aucun import de DOM, Pixi, React ou Zustand. Ce module doit tourner dans Node.
- **Tout est en référentiel local.** Les structures persistées (`height`, `Place`, `Road`, `fog`)
  stockent le monde d'avant le Cataclysme. Le référentiel monde ne s'obtient que par calcul :
  `lonWorld = lonLocal + Δλ_r(t)`, `Δλ_r(t) = ω_r · (t − t0) mod 360`.
- Pas de classes : des `interface` en lecture seule et des fonctions pures.
- Invariants à préserver et à tester : `cutSouthLat < cutNorthLat` ; un `Place` appartient à un
  seul anneau ; un `Road` appartient à un seul anneau — une route qui franchit une coupure est
  scindée à la création ; la longitude se wrap, la latitude se clamp.
- L'unité est dans le nom : `omegaDegPerDay`, `heightM`, `seaLevelM`, `tDays`, `radiusKm`. Les
  angles sont en degrés dans toute interface publique.
- Tests Vitest à côté du code, dont les aller-retours local ↔ monde et le wrap.

→ `docs/modele-monde.md`, `docs/temps.md`, `docs/fichier-pangee.md`

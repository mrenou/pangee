import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    // Le rendu logiciel suffit : on vérifie que le shader compile et que la
    // carte se dessine, pas les performances.
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] },
    // Les captures comparées au pixel près supposent une carte immobile : les
    // animations se coupent d'elles-mêmes pour qui réduit les mouvements. Les
    // tests d'animation le rétablissent explicitement.
    reducedMotion: 'reduce',
  },
  // Les tests visent le serveur de développement, et non un build servi en
  // statique : c'est là que React monte chaque composant deux fois, ce qui
  // révèle les erreurs de cycle de vie. Un défaut de cette famille a échappé
  // deux fois à une suite qui ne testait que le build — le moteur de rendu ne
  // recevait jamais le relief, et la carte restait un aplat de parchemin.
  // Le build de production reste vérifié par `npm run build` en intégration.
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

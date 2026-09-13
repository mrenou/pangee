import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * Test de fumée : le shader compile, la carte se dessine, l'hydrologie tourne,
 * et la date fait glisser les anneaux de façon réversible.
 * Voir docs/rendu.md, docs/temps.md et docs/hydrologie.md.
 */

/**
 * Empreinte du canvas. On passe par une capture d'écran et non par readPixels :
 * WebGL vide son tampon de dessin après composition, il en reviendrait du noir.
 */
async function canvasHash(page: Page): Promise<string> {
  const shot = await page.locator('canvas').screenshot();
  return createHash('sha1').update(shot).digest('hex');
}

/** L'indicateur du panneau, qui porte l'état du dernier calcul hydrologique. */
function hydroStatus(page: Page) {
  return page.locator('[data-hydro-version]');
}

async function hydroVersion(page: Page): Promise<number> {
  return Number(await hydroStatus(page).getAttribute('data-hydro-version'));
}

/**
 * Attend que la carte soit au repos : relief généré, eau calculée, image
 * composée. Sans cela, deux captures du même état peuvent différer simplement
 * parce que l'eau est arrivée entre les deux.
 *
 * `after` permet d'exiger un calcul strictement plus récent, ce qui est
 * indispensable après une régénération : l'affichage montre encore l'eau du
 * monde précédent. La valeur par défaut, 0, impose d'attendre le tout premier
 * calcul — au chargement, rien ne tourne encore, et se contenter de « aucun
 * calcul en cours » ferait mesurer une carte vide.
 */
async function waitForStillMap(page: Page, after = 0): Promise<number> {
  await expect(page.getByRole('button', { name: 'Régénérer' })).toBeEnabled({ timeout: 60_000 });
  await expect(hydroStatus(page)).toHaveAttribute('data-hydro-computing', 'false', {
    timeout: 60_000,
  });
  await expect.poll(() => hydroVersion(page), { timeout: 60_000 }).toBeGreaterThan(after);
  await page.waitForTimeout(600);
  return hydroVersion(page);
}

test('la carte se dessine et les anneaux glissent avec la date', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pangée' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  let version = await waitForStillMap(page);

  const atT0 = await canvasHash(page);

  // Le rendu est stable tant que rien ne change.
  expect(await canvasHash(page)).toBe(atT0);

  // Avancer la date fait tourner les anneaux nord et sud.
  await page.getByLabel('Date de campagne').fill('20000');
  version = await waitForStillMap(page, version);
  expect(await canvasHash(page)).not.toBe(atT0);

  // Revenir au Cataclysme redonne exactement la carte d'origine : l'état du
  // monde est une fonction pure de la date, rien n'est accumulé — et cela vaut
  // aussi pour l'eau, recalculée de zéro à chaque fois.
  await page.getByRole('button', { name: 'Revenir au Cataclysme' }).click();
  await waitForStillMap(page, version);
  expect(await canvasHash(page)).toBe(atT0);

  expect(errors).toEqual([]);
});

test('la même graine redonne le même monde', async ({ page }) => {
  await page.goto('/');
  let version = await waitForStillMap(page);
  const first = await canvasHash(page);

  await page.getByLabel('Graine').fill('autre-monde');
  await page.getByRole('button', { name: 'Régénérer' }).click();
  version = await waitForStillMap(page, version);
  expect(await canvasHash(page)).not.toBe(first);

  await page.getByLabel('Graine').fill('pangee');
  await page.getByRole('button', { name: 'Régénérer' }).click();
  await waitForStillMap(page, version);
  expect(await canvasHash(page)).toBe(first);
});

test("l'hydrologie trouve des lacs et reste sous la seconde", async ({ page }) => {
  await page.goto('/');
  await waitForStillMap(page);

  const status = hydroStatus(page);
  expect(Number(await status.getAttribute('data-hydro-lakes'))).toBeGreaterThan(0);
  expect(Number(await status.getAttribute('data-hydro-elapsed-ms'))).toBeLessThan(1000);
});

import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * Test de fumée : le shader compile, la carte se dessine, et la date fait
 * glisser les anneaux de façon réversible. Voir docs/rendu.md et docs/temps.md.
 */

/**
 * Empreinte du canvas. On passe par une capture d'écran et non par readPixels :
 * WebGL vide son tampon de dessin après composition, il en reviendrait du noir.
 */
async function canvasHash(page: Page): Promise<string> {
  const shot = await page.locator('canvas').screenshot();
  return createHash('sha1').update(shot).digest('hex');
}

async function waitForWorld(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Régénérer' })).toBeEnabled({ timeout: 60_000 });
  // Le relief arrive par un worker puis part vers le GPU : on laisse une image
  // se composer avant de mesurer.
  await page.waitForTimeout(2000);
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
  await waitForWorld(page);

  const atT0 = await canvasHash(page);

  // Le rendu est stable tant que rien ne change.
  expect(await canvasHash(page)).toBe(atT0);

  // Avancer la date fait tourner les anneaux nord et sud.
  await page.getByLabel('Date de campagne').fill('20000');
  await page.waitForTimeout(500);
  expect(await canvasHash(page)).not.toBe(atT0);

  // Revenir au Cataclysme redonne exactement la carte d'origine : l'état du
  // monde est une fonction pure de la date, rien n'est accumulé.
  await page.getByRole('button', { name: 'Revenir au Cataclysme' }).click();
  await page.waitForTimeout(500);
  expect(await canvasHash(page)).toBe(atT0);

  expect(errors).toEqual([]);
});

test('la même graine redonne le même monde', async ({ page }) => {
  await page.goto('/');
  await waitForWorld(page);
  const first = await canvasHash(page);

  await page.getByLabel('Graine').fill('autre-monde');
  await page.getByRole('button', { name: 'Régénérer' }).click();
  await waitForWorld(page);
  expect(await canvasHash(page)).not.toBe(first);

  await page.getByLabel('Graine').fill('pangee');
  await page.getByRole('button', { name: 'Régénérer' }).click();
  await waitForWorld(page);
  expect(await canvasHash(page)).toBe(first);
});

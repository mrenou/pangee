import { expect, test, type Page } from '@playwright/test';

/**
 * Time-lapse : la date avance d'elle-même et l'eau suit sans attendre la
 * pause. Voir docs/temps.md.
 */

const dateSlider = (page: Page) => page.getByRole('slider', { name: /Date de campagne/ });
const hydroVersion = async (page: Page): Promise<number> =>
  Number(await page.locator('[data-hydro-version]').getAttribute('data-hydro-version'));

test('lire fait tourner les anneaux, et l eau suit pendant la lecture', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect.poll(() => hydroVersion(page), { timeout: 60_000 }).toBeGreaterThan(0);

  await page.getByLabel('Vitesse de lecture').selectOption('100');
  const before = await hydroVersion(page);
  await page.getByRole('button', { name: '▶ Lire' }).click();

  // Avec un debounce, aucun calcul ne passerait tant que la date bouge.
  await expect.poll(() => hydroVersion(page), { timeout: 20_000 }).toBeGreaterThan(before + 1);
  await expect.poll(async () => Number(await dateSlider(page).inputValue())).toBeGreaterThan(50);

  await page.getByRole('button', { name: '❚❚ Pause' }).click();
  const paused = Number(await dateSlider(page).inputValue());
  await page.waitForTimeout(500);
  expect(Number(await dateSlider(page).inputValue())).toBe(paused);
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';

/**
 * Outil route : tracé droit et tracé qui suit le relief.
 * Voir docs/editeur.md.
 */
test('une route suivant le relief se trace, se retouche et s annule', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(
      async () =>
        Number(await page.locator('[data-hydro-version]').getAttribute('data-hydro-version')),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await page.getByLabel('Suivre le relief').check();

  const box = (await page.locator('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.click(cx - 120, cy + 10);
  await page.mouse.click(cx + 40, cy - 30);
  // Un tronçon de trop, rejeté au clavier.
  await page.mouse.click(cx + 200, cy + 60);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: /Annuler : route tracée/ })).toBeVisible();
  await page.getByRole('button', { name: /Annuler : route tracée/ }).click();
  await expect(page.getByRole('button', { name: 'Annuler' })).toBeDisabled();
});

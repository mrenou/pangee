import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * Créatures décoratives : trajectoire, animation, enregistrement.
 * Voir docs/editeur.md et docs/rendu.md.
 */

test.use({ reducedMotion: 'no-preference' });

async function waitForWorld(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        Number(await page.locator('[data-hydro-version]').getAttribute('data-hydro-version')),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
}

async function clipHash(page: Page, x: number, y: number): Promise<string> {
  const shot = await page.screenshot({ clip: { x, y, width: 260, height: 160 } });
  return createHash('sha1').update(shot).digest('hex');
}

test('un dragon tracé vole, se retouche et survit au rechargement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForWorld(page);
  await expect(page.getByLabel('Animer l’eau, les volcans et les créatures')).toBeChecked();

  await page.getByRole('button', { name: 'Créature', exact: true }).click();
  const box = (await page.locator('canvas').boundingBox())!;
  const x0 = box.x + 80;
  const y0 = box.y + 80;
  await page.mouse.click(x0, y0);
  await page.mouse.click(x0 + 200, y0);
  await page.mouse.click(x0 + 100, y0 + 100);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Annuler : créature ajoutée/ })).toBeVisible();
  await expect(page.getByLabel('Nom')).toHaveValue('Dragon');

  await page.getByLabel('Nom').fill('Vermithrax');
  await page.getByLabel('Nom').press('Enter');
  await page.locator('#creature-speed').fill('8');

  const first = await clipHash(page, x0 - 30, y0 - 30);
  await page.waitForTimeout(600);
  expect(await clipHash(page, x0 - 30, y0 - 30)).not.toBe(first);

  // L'autosave est différé : on lui laisse le temps d'écrire.
  await page.waitForTimeout(2500);
  await page.reload();
  await waitForWorld(page);
  await page.getByRole('button', { name: 'Créature', exact: true }).click();
  await page.mouse.click(x0 + 100, y0);
  await expect(page.getByLabel('Nom')).toHaveValue('Vermithrax');

  await page.keyboard.press('Delete');
  await expect(page.getByRole('button', { name: /Annuler : créature retirée/ })).toBeVisible();
  expect(errors).toEqual([]);
});

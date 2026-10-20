import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * Brouillard de guerre dans l'éditeur : voile, pinceau, annulation.
 * Voir docs/partage.md.
 */

async function canvasHash(page: Page): Promise<string> {
  return createHash('sha1')
    .update(await page.locator('canvas').screenshot())
    .digest('hex');
}

test('le pinceau révèle sous le voile, et s annule', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect
    .poll(
      async () =>
        Number(await page.locator('[data-hydro-version]').getAttribute('data-hydro-version')),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(600);
  const bare = await canvasHash(page);

  // Un monde neuf n'a rien montré aux joueurs : l'outil fait tomber le voile.
  await page.getByRole('button', { name: 'Brouillard', exact: true }).click();
  await page.waitForTimeout(300);
  const veiled = await canvasHash(page);
  expect(veiled).not.toBe(bare);

  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(box.x + box.width / 2 - 100 + i * 20, box.y + box.height / 2);
  }
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /Annuler : brouillard peint/ })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await canvasHash(page)).not.toBe(veiled);

  await page.getByRole('button', { name: /Annuler : brouillard peint/ }).click();
  await page.waitForTimeout(300);
  expect(await canvasHash(page)).toBe(veiled);

  // Tout révéler lève le voile en une commande ; revenir au déplacement le retire.
  await page.getByRole('button', { name: 'Tout révéler' }).click();
  await expect(page.getByRole('button', { name: /Annuler : tout révélé/ })).toBeVisible();
  await page.getByRole('button', { name: 'Déplacer' }).click();
  await page.waitForTimeout(300);
  expect(await canvasHash(page)).toBe(bare);
  expect(errors).toEqual([]);
});

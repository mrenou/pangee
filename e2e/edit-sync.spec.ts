import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * Les éditions raster atteignent le worker hydrologique : l'eau suit le
 * pinceau relief, le climat suit le pinceau biome.
 * Voir docs/editeur.md et docs/architecture.md.
 */

function hydroStatus(page: Page) {
  return page.locator('[data-hydro-version]');
}

async function attr(page: Page, name: string): Promise<number> {
  return Number(await hydroStatus(page).getAttribute(name));
}

/** Attend un calcul hydrologique strictement plus récent que `after`, et terminé. */
async function waitForHydro(page: Page, after: number): Promise<number> {
  await expect
    .poll(() => attr(page, 'data-hydro-version'), { timeout: 60_000 })
    .toBeGreaterThan(after);
  await expect(hydroStatus(page)).toHaveAttribute('data-hydro-computing', 'false', {
    timeout: 60_000,
  });
  await page.waitForTimeout(600);
  return attr(page, 'data-hydro-version');
}

async function canvasHash(page: Page): Promise<string> {
  return createHash('sha1')
    .update(await page.locator('canvas').screenshot())
    .digest('hex');
}

/** Un trait horizontal sur toute la largeur de la carte, en un seul geste. */
async function sweep(page: Page, yFraction: number): Promise<void> {
  const box = (await page.locator('canvas').boundingBox())!;
  const y = box.y + box.height * yFraction;
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i += 1) {
    await page.mouse.move(box.x + 20 + ((box.width - 40) * i) / 30, y);
  }
  await page.mouse.up();
}

test('creuser le relief change les lacs que calcule le worker', async ({ page }) => {
  await page.goto('/');
  const version = await waitForHydro(page, 0);
  const lakesBefore = await attr(page, 'data-hydro-lakes');

  // Des tranchées profondes à travers les terres ouvrent des cuvettes : sans
  // le relief retouché, le worker retrouverait exactement les mêmes lacs.
  await page.getByRole('button', { name: 'Relief' }).click();
  await page.getByRole('button', { name: 'Baisser' }).click();
  for (const y of [0.3, 0.45, 0.6, 0.75]) await sweep(page, y);

  await waitForHydro(page, version);
  expect(await attr(page, 'data-hydro-lakes')).not.toBe(lakesBefore);
});

test('peindre un biome change la carte une fois le climat recalculé', async ({ page }) => {
  await page.goto('/');
  const version = await waitForHydro(page, 0);
  const before = await canvasHash(page);

  await page.getByRole('button', { name: 'Biome' }).click();
  await page.getByLabel('Biome posé').selectOption({ label: 'Désert' });
  await sweep(page, 0.5);

  await waitForHydro(page, version);
  expect(await canvasHash(page)).not.toBe(before);
});

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/**
 * Export PNG d'une zone : cadrage, rendu hors écran, téléchargement.
 * Voir docs/partage.md.
 */

async function waitForWorld(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        Number(await page.locator('[data-hydro-version]').getAttribute('data-hydro-version')),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
}

/** Largeur et hauteur lues dans l'en-tête IHDR du PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function frame(page: Page): Promise<void> {
  const box = (await page.locator('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 200, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.mouse.move(cx + 200, cy + 100, { steps: 4 });
  await page.mouse.up();
}

test('un cadre s exporte en PNG à la largeur demandée', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForWorld(page);

  // Un peu de terrain révélé, pour que le brouillard laisse voir quelque chose.
  await page.getByRole('button', { name: 'Brouillard', exact: true }).click();
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exporter en PNG' })).toBeDisabled();
  await frame(page);

  await page.getByLabel('Largeur de l’image (px)').fill('1600');
  await page.getByLabel('Titre du cartouche').fill('Les marches de Kerth');
  await expect(page.getByText('1600 × 800 px')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter en PNG' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/jour 0\.png$/);

  const bytes = await readFile(await file.path());
  expect(pngSize(bytes)).toEqual({ width: 1600, height: 800 });
  await file.saveAs('.context/export-brouillard.png');

  // Sans brouillard, la même zone.
  await page.getByLabel('Appliquer le brouillard (Terra incognita)').uncheck();
  const second = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter en PNG' }).click();
  await (await second).saveAs('.context/export-complet.png');
  expect(errors).toEqual([]);
});

test('un export trop grand est refusé avec une largeur de repli', async ({ page }) => {
  await page.goto('/');
  await waitForWorld(page);
  await page.getByRole('button', { name: 'Image', exact: true }).click();
  await frame(page);

  await page.getByLabel('Largeur de l’image (px)').fill('20000');
  await expect(page.getByRole('alert')).toContainText('Export trop grand');
  await expect(page.getByRole('button', { name: 'Exporter en PNG' })).toBeDisabled();
  await page.getByRole('button', { name: /^Utiliser \d+ px$/ }).click();
  await expect(page.getByRole('button', { name: 'Exporter en PNG' })).toBeEnabled();
});

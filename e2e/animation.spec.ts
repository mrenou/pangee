import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * Animations : la carte vit quand on le demande, et redevient une image fixe
 * sinon. Voir docs/rendu.md.
 */

async function canvasHash(page: Page): Promise<string> {
  return createHash('sha1')
    .update(await page.locator('canvas').screenshot())
    .digest('hex');
}

async function waitForWorld(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        Number(await page.locator('[data-hydro-version]').getAttribute('data-hydro-version')),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(600);
}

const toggle = (page: Page) => page.getByLabel('Animer l’eau, les volcans et les créatures');

test.describe('sans réduction des mouvements', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('l eau bouge, puis se fige quand on coupe l animation', async ({ page }) => {
    // Animée, la carte se redessine à chaque image : en rendu logiciel, sur le
    // runner d'intégration, chaque capture se fait attendre.
    test.slow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await waitForWorld(page);
    await expect(toggle(page)).toBeChecked();

    const first = await canvasHash(page);
    await page.waitForTimeout(700);
    expect(await canvasHash(page)).not.toBe(first);

    await toggle(page).uncheck();
    await page.waitForTimeout(300);
    const still = await canvasHash(page);
    await page.waitForTimeout(700);
    expect(await canvasHash(page)).toBe(still);
    expect(errors).toEqual([]);
  });
});

test('les animations sont coupées d office pour qui réduit les mouvements', async ({ page }) => {
  await page.goto('/');
  await waitForWorld(page);
  await expect(toggle(page)).not.toBeChecked();
});

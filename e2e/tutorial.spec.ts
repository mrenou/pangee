import { expect, test, type Page } from '@playwright/test';

/**
 * Tutoriel : chaque étape désigne un élément, attend qu'on le manipule, et la
 * sortie rend le monde d'avant. Voir docs/tutoriel.md.
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

test('le tutoriel fait manipuler chaque fonctionnalité puis rend le monde', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await waitForWorld(page);
  const date = page.getByLabel('Date de campagne');
  const dateBefore = await date.inputValue();

  await page.getByRole('button', { name: 'Tutoriel' }).click();
  const card = page.getByRole('dialog', { name: 'Tutoriel' });
  await expect(card.getByRole('heading', { name: 'Bienvenue sur Pangée' })).toBeVisible();
  await card.getByRole('button', { name: 'Commencer' }).click();

  // La carte : glisser, puis zoomer.
  await expect(card.getByRole('heading', { name: 'La carte' })).toBeVisible();
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + 400, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 460, box.y + 230, { steps: 4 });
  await page.mouse.up();
  await page.mouse.wheel(0, -200);
  await expect(card.getByText('Bien joué !')).toBeVisible();
  await card.getByRole('button', { name: 'Suivant' }).click();

  // La date : l'élément désigné est entouré, la consigne se coche.
  await expect(card.getByRole('heading', { name: 'La date de campagne' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Passer' })).toBeVisible();
  await date.fill('500');
  await expect(card.getByText('Bien joué !')).toBeVisible();
  await card.getByRole('button', { name: 'Suivant' }).click();

  // Le time-lapse : lancer, mettre en pause, revenir au Cataclysme, dans l'ordre.
  await page.getByRole('button', { name: '▶ Lire' }).click();
  await page.getByRole('button', { name: '❚❚ Pause' }).click();
  await expect(card.getByText('Bien joué !')).toBeHidden();
  await page.getByRole('button', { name: 'Revenir au Cataclysme' }).click();
  await expect(card.getByText('Bien joué !')).toBeVisible();

  // On saute jusqu'au relief.
  while (!(await card.getByRole('heading', { name: 'Sculpter le relief' }).isVisible())) {
    await card.getByRole('button', { name: /^(Passer|Suivant)$/ }).click();
  }
  await page.getByRole('button', { name: 'Relief', exact: true }).click();
  await page.mouse.move(box.x + 320, box.y + 300);
  await page.mouse.down();
  for (let i = 0; i < 8; i += 1) await page.mouse.move(box.x + 320 + i * 20, box.y + 300);
  await page.mouse.up();
  await expect(card.getByText('Bien joué !')).toBeVisible();

  // Quitter : le monde a changé, on le rétablit.
  await card.getByRole('button', { name: 'Quitter le tutoriel' }).click();
  await card.getByRole('button', { name: 'Rétablir mon monde d’avant' }).click();
  await expect(card).toBeHidden();
  await expect(date).toHaveValue(dateBefore);
  await expect(page.getByRole('button', { name: /^Annuler/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Déplacer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  expect(errors).toEqual([]);
});

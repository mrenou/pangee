import { expect, test } from '@playwright/test';

/**
 * Inspecteur de lieu : poser, renommer, supprimer, annuler.
 * Voir docs/editeur.md.
 */
test('un lieu posé s ouvre dans l inspecteur et se retouche', async ({ page }) => {
  await page.goto('/');
  // Le bouton Régénérer est actif avant même le lancement de la génération :
  // seul un premier calcul hydrologique garantit qu'il y a un monde à éditer.
  await expect
    .poll(
      async () =>
        Number(await page.locator('[data-hydro-version]').getAttribute('data-hydro-version')),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Lieu', exact: true }).click();

  const box = (await page.locator('canvas').boundingBox())!;
  // Un coin de carte plutôt que le centre, où un lieu généré pourrait déjà se trouver.
  await page.mouse.click(box.x + 37, box.y + 41);

  const name = page.getByLabel('Nom');
  await expect(name).toBeVisible();
  await name.fill('Haute-Kerth');
  await name.press('Enter');
  await expect(page.getByRole('button', { name: /Annuler : lieu renommé/ })).toBeVisible();

  await page.getByLabel('Type').selectOption('fortress');
  await expect(page.getByRole('button', { name: /Annuler : type du lieu/ })).toBeVisible();

  // Glisser déplace le lieu en une seule commande, quel que soit le nombre de pas.
  await page.mouse.move(box.x + 37, box.y + 41);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 70, { steps: 6 });
  await page.mouse.move(box.x + 90, box.y + 95, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /Annuler : lieu déplacé/ })).toBeVisible();
  await expect(page.getByLabel('Nom')).toHaveValue('Haute-Kerth');

  await page.getByRole('button', { name: /Supprimer le lieu/ }).click();
  await expect(name).toBeHidden();

  // Annuler la suppression rend le lieu, avec ses retouches.
  await page.getByRole('button', { name: /Annuler : lieu supprimé/ }).click();
  await page.mouse.click(box.x + 90, box.y + 95);
  await expect(page.getByLabel('Nom')).toHaveValue('Haute-Kerth');
  await expect(page.getByLabel('Type')).toHaveValue('fortress');
});

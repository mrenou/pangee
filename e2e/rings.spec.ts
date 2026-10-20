import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * Anneaux en nombre variable : scinder, régler, fusionner, annuler,
 * retrouver après rechargement. Voir docs/modele-monde.md et docs/editeur.md.
 */

const hydroVersion = async (page: Page): Promise<number> =>
  Number(await page.locator('[data-hydro-version]').getAttribute('data-hydro-version'));

/** Attend un calcul hydrologique plus récent que `after`, terminé, et l'image posée. */
async function waitForWorld(page: Page, after = 0): Promise<number> {
  await expect.poll(() => hydroVersion(page), { timeout: 60_000 }).toBeGreaterThan(after);
  await expect(page.locator('[data-hydro-version]')).toHaveAttribute(
    'data-hydro-computing',
    'false',
    { timeout: 60_000 },
  );
  await page.waitForTimeout(600);
  return hydroVersion(page);
}

async function canvasHash(page: Page): Promise<string> {
  return createHash('sha1')
    .update(await page.locator('canvas').screenshot())
    .digest('hex');
}

/** Nombre d'anneaux affiché : le monde de départ n'en a pas un nombre fixe. */
async function ringCount(page: Page): Promise<number> {
  const text = await page.getByText(/\d anneaux? sur 8 possibles\./).textContent();
  return Number(/(\d)/.exec(text ?? '')?.[1]);
}

const anneaux = (n: number): string => `${n} anneau${n > 1 ? 'x' : ''} sur 8 possibles.`;

const scinder = (page: Page) => page.getByRole('button', { name: 'Scinder' });
const fusionner = (page: Page) => page.getByRole('button', { name: 'Fusionner' });

test('scinder un anneau en ajoute un, qu on peut faire tourner, puis fusionner', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  let version = await waitForWorld(page);
  const start = await ringCount(page);
  // Scinder suppose qu'il reste de la place pour un anneau de plus.
  expect(start).toBeLessThan(8);
  // Le nouvel anneau reçoit le premier identifiant libre, `ring-<n + 1>`.
  const omega = page.locator(`#omega-ring-${start + 1}`);

  // On avance la date : un anneau neuf qui ne tournerait pas comme son parent
  // ferait sauter sa moitié de carte sur-le-champ.
  // La nouvelle coupure trace sa ligne de faille : on les masque pour ne
  // comparer que le terrain.
  await page.getByLabel('Marquer les lignes de faille').uncheck();
  await page.getByRole('slider', { name: /Date de campagne/ }).fill('400');
  version = await waitForWorld(page, version);
  const before = await canvasHash(page);

  await scinder(page).first().click();
  await expect(page.getByText(anneaux(start + 1))).toBeVisible();
  await expect(page.getByRole('button', { name: /Annuler : anneau scindé/ })).toBeVisible();
  // L'eau est recalculée pour le nouveau découpage : on attend qu'elle arrive.
  await waitForWorld(page, version);
  // La moitié hérite de la vitesse de son parent : à cette date, rien n'a bougé.
  expect(await canvasHash(page)).toBe(before);

  // Le nouvel anneau se règle comme les autres.
  await omega.fill('-0.3');
  await page.waitForTimeout(400);
  expect(await canvasHash(page)).not.toBe(before);

  // Il survit au rechargement, avec sa vitesse.
  await page.waitForTimeout(2500);
  await page.reload();
  await waitForWorld(page);
  await expect(page.getByText(anneaux(start + 1))).toBeVisible();
  await expect(omega).toHaveValue('-0.3');

  await fusionner(page).first().click();
  await expect(page.getByText(anneaux(start))).toBeVisible();
  await page.getByRole('button', { name: /Annuler : anneaux fusionnés/ }).click();
  await expect(page.getByText(anneaux(start + 1))).toBeVisible();
  expect(errors).toEqual([]);
});

test('le bouton Scinder se désactive au huitième anneau', async ({ page }) => {
  await page.goto('/');
  await waitForWorld(page);
  // Scinder toujours le même anneau le réduirait au pôle : on alterne le
  // premier et le dernier, qui restent les plus larges.
  for (let n = await ringCount(page); n < 8; n += 1) {
    await (n % 2 === 1 ? scinder(page).first() : scinder(page).last()).click();
  }
  await expect(page.getByText('8 anneaux sur 8 possibles.')).toBeVisible();
  for (const button of await scinder(page).all()) await expect(button).toBeDisabled();
});

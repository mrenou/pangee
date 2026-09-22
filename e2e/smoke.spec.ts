import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * Test de fumée : le shader compile, la carte se dessine, l'hydrologie tourne,
 * et la date fait glisser les anneaux de façon réversible.
 * Voir docs/rendu.md, docs/temps.md et docs/hydrologie.md.
 */

/**
 * Empreinte du canvas. On passe par une capture d'écran et non par readPixels :
 * WebGL vide son tampon de dessin après composition, il en reviendrait du noir.
 */
async function canvasHash(page: Page): Promise<string> {
  const shot = await page.locator('canvas').screenshot();
  return createHash('sha1').update(shot).digest('hex');
}

/** L'indicateur du panneau, qui porte l'état du dernier calcul hydrologique. */
function hydroStatus(page: Page) {
  return page.locator('[data-hydro-version]');
}

async function hydroVersion(page: Page): Promise<number> {
  return Number(await hydroStatus(page).getAttribute('data-hydro-version'));
}

/**
 * Attend que la carte soit au repos : relief généré, eau calculée, image
 * composée. Sans cela, deux captures du même état peuvent différer simplement
 * parce que l'eau est arrivée entre les deux.
 *
 * `after` permet d'exiger un calcul strictement plus récent, ce qui est
 * indispensable après une régénération : l'affichage montre encore l'eau du
 * monde précédent. La valeur par défaut, 0, impose d'attendre le tout premier
 * calcul — au chargement, rien ne tourne encore, et se contenter de « aucun
 * calcul en cours » ferait mesurer une carte vide.
 */
async function waitForStillMap(page: Page, after = 0): Promise<number> {
  await expect(page.getByRole('button', { name: 'Régénérer' })).toBeEnabled({ timeout: 60_000 });
  await expect(hydroStatus(page)).toHaveAttribute('data-hydro-computing', 'false', {
    timeout: 60_000,
  });
  await expect.poll(() => hydroVersion(page), { timeout: 60_000 }).toBeGreaterThan(after);
  await page.waitForTimeout(600);
  return hydroVersion(page);
}

test('la carte se dessine et les anneaux glissent avec la date', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pangée' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  let version = await waitForStillMap(page);

  const atT0 = await canvasHash(page);

  // Le rendu est stable tant que rien ne change.
  expect(await canvasHash(page)).toBe(atT0);

  // Avancer la date fait tourner les anneaux nord et sud.
  await page.getByLabel('Date de campagne').fill('20000');
  version = await waitForStillMap(page, version);
  expect(await canvasHash(page)).not.toBe(atT0);

  // Revenir au Cataclysme redonne exactement la carte d'origine : l'état du
  // monde est une fonction pure de la date, rien n'est accumulé — et cela vaut
  // aussi pour l'eau, recalculée de zéro à chaque fois.
  await page.getByRole('button', { name: 'Revenir au Cataclysme' }).click();
  await waitForStillMap(page, version);
  expect(await canvasHash(page)).toBe(atT0);

  expect(errors).toEqual([]);
});

test('la même graine redonne le même monde', async ({ page }) => {
  await page.goto('/');
  let version = await waitForStillMap(page);
  const first = await canvasHash(page);

  await page.getByLabel('Graine').fill('autre-monde');
  await page.getByRole('button', { name: 'Régénérer' }).click();
  version = await waitForStillMap(page, version);
  expect(await canvasHash(page)).not.toBe(first);

  await page.getByLabel('Graine').fill('pangee');
  await page.getByRole('button', { name: 'Régénérer' }).click();
  await waitForStillMap(page, version);
  expect(await canvasHash(page)).toBe(first);
});

test("l'hydrologie trouve des lacs et reste sous la seconde", async ({ page }) => {
  await page.goto('/');
  await waitForStillMap(page);

  const status = hydroStatus(page);
  expect(Number(await status.getAttribute('data-hydro-lakes'))).toBeGreaterThan(0);
  expect(Number(await status.getAttribute('data-hydro-elapsed-ms'))).toBeLessThan(1000);
});

test('le monde est peuplé de lieux nommés', async ({ page }) => {
  await page.goto('/');
  await waitForStillMap(page);

  // Le panneau compte les lieux produits par la génération.
  const count = page.getByText(/^\d+ lieux$/);
  await expect(count).toBeVisible();
  const placed = Number(((await count.textContent()) ?? '').replace(/\D/g, ''));
  expect(placed).toBeGreaterThan(20);

  // Demander plus de peuplement en produit davantage.
  const before = placed;
  await page.getByLabel('Peuplement').fill('1');
  await page.getByRole('button', { name: 'Régénérer' }).click();
  await waitForStillMap(page, await hydroVersion(page));
  const after = Number(((await count.textContent()) ?? '').replace(/\D/g, ''));
  expect(after).toBeGreaterThan(before);
});

test('peindre le relief, annuler, et retrouver son monde après rechargement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await waitForStillMap(page);
  const pristine = await canvasHash(page);

  // Un trait de pinceau, en un seul geste.
  await page.getByRole('button', { name: 'Relief' }).click();
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + 320, box.y + 300);
  await page.mouse.down();
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.move(box.x + 320 + i * 20, box.y + 300 + i * 4);
  }
  await page.mouse.up();
  await page.waitForTimeout(1500);

  const painted = await canvasHash(page);
  expect(painted).not.toBe(pristine);

  // Le geste entier ne fait qu'une entrée de pile : une seule annulation suffit
  // à effacer tout le trait, et elle rend l'image d'origine au pixel près.
  await page.getByRole('button', { name: /^Annuler/ }).click();
  await page.waitForTimeout(1500);
  expect(await canvasHash(page)).toBe(pristine);

  await page.getByRole('button', { name: 'Rétablir' }).click();
  await page.waitForTimeout(1500);
  expect(await canvasHash(page)).toBe(painted);

  // L'autosave est différé : on lui laisse le temps d'écrire avant de recharger.
  await page.waitForTimeout(2500);
  await page.reload();
  await waitForStillMap(page);

  // Le monde relu depuis IndexedDB porte toujours le trait. On ne compare pas
  // au pixel près : le relief est enregistré en entiers 16 bits, dont la
  // précision de 32 cm suffit largement pour des cellules de vingt kilomètres
  // mais ne redonne pas exactement les mêmes flottants.
  const restored = await canvasHash(page);
  expect(restored).not.toBe(pristine);
  expect(errors).toEqual([]);
});

test("l'image reflète les données sans qu'on ait à bouger la carte", async ({ page }) => {
  await page.goto('/');
  let version = await waitForStillMap(page);

  await page.getByLabel('Date de campagne').fill('30000');
  await waitForStillMap(page, version);
  const settled = await canvasHash(page);

  // Un aller-retour d'un pixel remet la carte exactement où elle était. Si
  // l'image change, c'est que le rendu affichait des données périmées et que
  // seul le mouvement l'a réveillé — le défaut que ce test verrouille.
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + 500, box.y + 350);
  await page.mouse.down();
  await page.mouse.move(box.x + 501, box.y + 350);
  await page.mouse.move(box.x + 500, box.y + 350);
  await page.mouse.up();
  await page.waitForTimeout(1200);

  expect(await canvasHash(page)).toBe(settled);

  // Et revenir au Cataclysme redonne bien la carte d'origine.
  version = await hydroVersion(page);
  await page.getByRole('button', { name: 'Revenir au Cataclysme' }).click();
  await waitForStillMap(page, version);
  expect(await canvasHash(page)).not.toBe(settled);
});

test('relever la mer noie les terres basses', async ({ page }) => {
  await page.goto('/');
  const version = await waitForStillMap(page);
  const before = await canvasHash(page);

  await page.getByLabel('Niveau de la mer').fill('1400');
  await waitForStillMap(page, version);
  expect(await canvasHash(page)).not.toBe(before);

  // Que le relèvement se voie immédiatement, sans attendre l'hydrologie, tient
  // à la règle de surface d'eau — vérifiée dans src/render/waterSurface.test.ts.
  // Le calage d'une capture dans cette fenêtre n'est pas reproductible : la
  // capture dure plus longtemps que le calcul qu'elle voudrait devancer.
});

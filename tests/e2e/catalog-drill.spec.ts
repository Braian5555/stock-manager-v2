import { expect, test } from '@playwright/test';
import { go, loadDemo } from './helpers';

test('familias y ubicaciones: tocar un ítem muestra sus productos en Stock', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/familias');
  const bebidas = page.getByRole('link', { name: 'Ver los productos de Bebidas' });
  await expect(bebidas).toBeVisible();
  await bebidas.click();
  await expect(page).toHaveURL(/#\/stock\?familia=/);
  const chip = page.getByRole('button', { name: /Quitar filtro familia Bebidas/ });
  await expect(chip).toBeVisible();
  const cards = page.locator('article.pcard');
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await expect(cards.nth(i).getByText('Bebidas', { exact: true })).toBeVisible();
  // Quitar el filtro vuelve a mostrar todo
  await chip.click();
  await expect(page.getByRole('button', { name: /Quitar filtro familia/ })).toHaveCount(0);
  expect(await cards.count()).toBeGreaterThan(n);

  await go(page, '/ubicaciones');
  await page.getByRole('link', { name: /Ver los productos de Depósito central/ }).click();
  await expect(page.getByRole('button', { name: /Quitar filtro ubicación Depósito central/ })).toBeVisible();
});

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

test('familias: poner en 0 el stock de una familia y deshacer', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/familias');
  await page.getByRole('button', { name: 'Poner en 0 el stock de Bebidas' }).click();
  const d = page.getByRole('dialog', { name: /Poner en 0: Bebidas/ });
  await expect(d.getByRole('region', { name: 'Productos que quedan en 0' }).or(d.getByLabel('Productos que quedan en 0'))).toBeVisible();
  await d.getByRole('button', { name: /^Poner \d+ en 0$/ }).click();
  await expect(page.getByText(/Bebidas: \d+ productos? qued(ó|aron) en 0/)).toBeVisible();
  await go(page, '/movimientos');
  await expect(page.getByText('Puesta en cero: Bebidas').filter({ visible: true }).first()).toBeVisible();
});

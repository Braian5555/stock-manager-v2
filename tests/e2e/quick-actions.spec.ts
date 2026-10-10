import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('botón +: ingreso rápido y pedido a proveedor por WhatsApp', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/movimientos');
  // Ingreso desde cualquier pantalla
  await page.getByRole('button', { name: 'Acciones rápidas' }).click();
  await page.getByRole('menuitem', { name: 'Ingreso' }).click();
  await dialog(page).getByLabel('Buscar producto').fill('Harina');
  await dialog(page).getByRole('button', { name: /Harina 000/ }).click();
  const m = dialog(page);
  await expect(m.getByLabel('Tipo de movimiento')).toHaveValue('ingreso');
  await m.getByLabel('Cantidad').fill('5');
  await m.getByRole('button', { name: 'Registrar' }).click();
  await expect(m).toBeHidden();

  // Pedir a proveedor: elegir, cargar cantidad y mandar
  await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return null; }) as typeof window.open; });
  await page.getByRole('button', { name: 'Acciones rápidas' }).click();
  await page.getByRole('menuitem', { name: 'Pedir a proveedor' }).click();
  const d = dialog(page);
  await d.locator('.list-item').first().click();
  await expect(d.getByRole('heading', { name: /^Pedir a / })).toBeVisible();
  const inc = d.getByRole('button', { name: /^Sumar 1 a / }).first();
  await inc.click();
  await inc.click();
  await d.getByRole('button', { name: /Mandar por WhatsApp/ }).click();
  await expect(page).toHaveURL(/#\/pedidos\/[\w-]+$/);
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened[0]).toMatch(/^https:\/\/wa\.me\/\d*\?text=Pedido%20%23\d+/);
  await expect(page.getByText('Enviado').first()).toBeVisible();
});

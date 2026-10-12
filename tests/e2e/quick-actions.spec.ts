import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('botón +: ingreso rápido y sin acciones de compras', async ({ page }) => {
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

  // Lo de compras se retiró: el botón + ya no ofrece pedir a proveedores ni remitos.
  await page.getByRole('button', { name: 'Acciones rápidas' }).click();
  await expect(page.getByRole('menuitem', { name: 'Foto de factura' })).toBeVisible();
  for (const a of ['Pedir a proveedor', 'Remito']) await expect(page.getByRole('menuitem', { name: a })).toHaveCount(0);
});

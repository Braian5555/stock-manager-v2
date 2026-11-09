import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo, enableRecipes } from './helpers';

test('software gastronómico: receta en la carta, la venta descuenta stock, reportes y compras', async ({ page }) => {
  await loadDemo(page);
  await enableRecipes(page);
  await go(page, '/salon');
  await page.getByLabel('Cantidad de mesas').fill('2');
  await page.getByRole('button', { name: 'Crear mesas' }).click();

  // Carta: un plato con receta (sale del stock al venderlo).
  await go(page, '/salon?vista=carta');
  await page.getByRole('button', { name: 'Agregar el primero' }).click();
  let m = dialog(page);
  await m.getByLabel('Nombre').fill('Agua sin gas');
  await m.getByLabel('Sección').fill('Bebidas');
  await m.getByLabel('Precio', { exact: true }).fill('1500');
  await m.getByLabel('Agregar insumo').fill('Agua mineral 500 ml');
  await m.getByLabel('Cantidad de Agua mineral 500 ml').fill('1');
  await expect(m.getByRole('status', { name: 'Costo del plato' })).toContainText('Sin costo: Agua mineral 500 ml');
  await m.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Agregado a la carta')).toBeVisible();
  await expect(page.locator('main').getByText('sin costo')).toBeVisible();

  // Venta de 2 aguas en la mesa 1.
  await go(page, '/salon');
  await page.getByRole('button', { name: 'Mesa 1: Libre' }).click();
  m = dialog(page);
  await m.getByRole('button', { name: 'Agregar Agua sin gas' }).click();
  await m.getByRole('button', { name: 'Agregar Agua sin gas' }).click();
  if (!(await m.getByRole('region', { name: 'Pedido' }).isVisible())) await m.getByRole('group', { name: 'Ver' }).getByRole('button', { name: /^Pedido/ }).click();
  await m.getByRole('button', { name: /^Mandar a cocina/ }).click();
  await m.getByRole('button', { name: 'Cobrar', exact: true }).first().click();
  const pay = page.getByRole('dialog', { name: 'Cobrar · Mesa 1' });
  await pay.getByRole('button', { name: /^Cobrar .* y cerrar$/ }).click();
  await expect(page.getByText('Mesa 1: cobrado y cerrado')).toBeVisible();

  // El stock bajó con un movimiento "Venta".
  await go(page, '/movimientos');
  await expect(page.getByText(/Venta · Mesa 1/).filter({ visible: true }).first()).toBeVisible();

  // Reportes de ventas.
  await go(page, '/salon?vista=reportes');
  await expect(page.getByRole('heading', { name: 'Reportes de ventas', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Resumen del período')).toContainText(/3\.000/);
  await expect(page.getByRole('row', { name: /Agua sin gas/ })).toContainText('2');
  await expect(page.getByRole('heading', { name: 'Medios de pago' })).toBeVisible();
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Ayer' }).click();
  await expect(page.getByText('Sin ventas en este período')).toBeVisible();

  // Compras: proveedores con su cuenta y pedidos.
  await go(page, '/proveedores');
  await expect(page.getByText('Carnicería Ejemplo')).toBeVisible();
  await go(page, '/pedidos');
  await expect(page.getByRole('button', { name: 'Pedido sugerido' })).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('salón: armar mesas y carta, tomar un pedido, cocina lo marca listo y se cierra la mesa', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/salon');
  await expect(page.getByRole('heading', { name: 'Salón', level: 1 })).toBeVisible();

  // Mesas
  await page.getByLabel('Cantidad de mesas').fill('6');
  await page.getByRole('button', { name: 'Crear mesas' }).click();
  await expect(page.getByRole('list', { name: 'Mesas' }).getByRole('listitem')).toHaveCount(6);

  // Carta
  await page.getByRole('group', { name: 'Sección del salón' }).getByRole('button', { name: 'Carta' }).click();
  await page.getByRole('button', { name: 'Agregar el primero' }).click();
  let m = dialog(page);
  await m.getByLabel('Nombre').fill('Desayuno americano');
  await m.getByLabel('Sección').fill('Desayunos');
  await m.getByLabel('Precio').fill('9500');
  await m.getByLabel('Código en Maxirest').fill('101');
  await m.getByRole('button', { name: 'Guardar y otro' }).click();
  await expect(page.getByText('Agregado a la carta')).toBeVisible();
  await m.getByLabel('Nombre').fill('Café con leche');
  await m.getByLabel('Sección').fill('Cafetería');
  await m.getByLabel('Precio').fill('3200');
  await m.getByLabel('Va a la pantalla de cocina').uncheck();
  await m.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('1 plato no tiene código de Maxirest')).toBeVisible();

  // Pedido de la mesa 4
  await page.getByRole('group', { name: 'Sección del salón' }).getByRole('button', { name: 'Mesas' }).click();
  await page.getByRole('button', { name: 'Mesa 4: Libre' }).click();
  m = dialog(page);
  await expect(m.getByRole('heading', { name: 'Mesa 4' })).toBeVisible();
  await m.getByRole('button', { name: 'Agregar Desayuno americano' }).click();
  await m.getByRole('button', { name: 'Agregar Desayuno americano' }).click();
  await m.getByRole('button', { name: 'Agregar Café con leche' }).click();
  if (!(await m.getByRole('region', { name: 'Pedido' }).isVisible())) await m.getByRole('group', { name: 'Ver' }).getByRole('button', { name: /^Pedido/ }).click();
  await expect(m.locator('.salon-total')).toContainText(/22\.200/);
  await m.getByRole('button', { name: /^Mandar a cocina \(3\)/ }).click();
  await expect(page.getByText('Comanda mandada (3 platos)')).toBeVisible();
  await m.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Mesa 4: Ocupada/ })).toBeVisible();

  // Cocina
  await go(page, '/cocina');
  const card = page.getByRole('listitem', { name: 'Mesa 4' });
  await expect(card).toContainText('Desayuno americano');
  await expect(card).not.toContainText('Café con leche');
  await card.getByRole('button', { name: 'Todo listo' }).click();
  await expect(page.getByText('Sin comandas pendientes')).toBeVisible();

  // Vuelve al salón: listo para llevar, se lleva, pide la cuenta y se cierra.
  await go(page, '/salon');
  await expect(page.getByText('Para llevar: mesa 4')).toBeVisible();
  await page.getByRole('button', { name: 'Mesa 4: Listo para llevar' }).click();
  m = dialog(page);
  await m.getByRole('button', { name: 'Todo llevado' }).or(m.getByRole('group', { name: 'Ver' })).first().waitFor();
  if (!(await m.getByRole('button', { name: 'Todo llevado' }).isVisible())) await m.getByRole('group', { name: 'Ver' }).getByRole('button', { name: /^Pedido/ }).click();
  await m.getByRole('button', { name: 'Todo llevado' }).click();
  await m.getByRole('button', { name: 'Pidió la cuenta' }).click();
  await m.getByRole('button', { name: 'Cobrar y cerrar' }).first().click();
  const pay = page.getByRole('dialog', { name: 'Cobrar mesa 4' });
  await expect(pay.getByText('La factura se hace en Maxirest')).toBeVisible();
  await pay.getByRole('button', { name: /^Cobrar .* y cerrar$/ }).click();
  await expect(page.getByText('Mesa 4 cobrada y cerrada')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mesa 4: Libre' })).toBeVisible();

  await page.getByRole('group', { name: 'Sección del salón' }).getByRole('button', { name: 'Hoy' }).click();
  await expect(page.getByText('Esperando Maxirest')).toBeVisible();
  await expect(page.getByText('1 pedido espera para pasar a Maxirest')).toBeVisible();
});

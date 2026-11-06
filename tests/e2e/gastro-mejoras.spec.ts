import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('salón ágil: barra separada de cocina, cierre del día y libro IVA', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/salon');
  await page.getByLabel('Cantidad de mesas').fill('2');
  await page.getByRole('button', { name: 'Crear mesas' }).click();

  await go(page, '/salon?vista=carta');
  await page.getByRole('button', { name: 'Agregar el primero' }).click();
  let m = dialog(page);
  await m.getByLabel('Nombre').fill('Café doble');
  await m.getByLabel('Sección').fill('Cafetería');
  await m.getByLabel('Precio', { exact: true }).fill('2500');
  await m.getByRole('group', { name: 'Lo prepara' }).getByRole('button', { name: /Barra/ }).click();
  await m.getByRole('button', { name: 'Guardar y otro' }).click();
  await expect(page.getByText('Agregado a la carta')).toBeVisible();
  await m.getByLabel('Nombre').fill('Tostado');
  await m.getByLabel('Sección').fill('Salado');
  await m.getByLabel('Precio', { exact: true }).fill('6000');
  await m.getByRole('group', { name: 'Lo prepara' }).getByRole('button', { name: 'Cocina' }).click();
  await m.getByRole('button', { name: 'Guardar', exact: true }).click();

  await go(page, '/salon');
  await page.getByRole('button', { name: 'Mesa 1: Libre' }).click();
  m = dialog(page);
  await m.getByRole('button', { name: 'Agregar Café doble' }).click();
  await m.getByRole('button', { name: 'Agregar Tostado' }).click();
  if (!(await m.getByRole('region', { name: 'Pedido' }).isVisible())) await m.getByRole('group', { name: 'Ver' }).getByRole('button', { name: /^Pedido/ }).click();
  await m.getByRole('button', { name: /^Mandar a cocina/ }).click();
  await m.getByRole('button', { name: 'Cerrar', exact: true }).click();

  // La barra ve sólo lo suyo y lo marca listo; la cocina sigue con el tostado.
  await go(page, '/cocina');
  await page.getByRole('group', { name: 'Puesto' }).getByRole('button', { name: 'Barra' }).click();
  await expect(page.getByRole('heading', { name: 'Barra', level: 1 })).toBeVisible();
  const card = page.getByRole('listitem', { name: 'Mesa 1' });
  await expect(card).toContainText('Café doble');
  await expect(card).not.toContainText('Tostado');
  await card.getByRole('button', { name: 'Todo listo' }).click();
  await expect(page.getByText('Sin comandas pendientes')).toBeVisible();
  await page.getByRole('group', { name: 'Puesto' }).getByRole('button', { name: 'Cocina' }).click();
  await expect(page.getByRole('listitem', { name: 'Mesa 1' })).toContainText('Tostado');
  await page.getByRole('group', { name: 'Puesto' }).getByRole('button', { name: 'Todo' }).click();

  // Cobrar y cierre del día.
  await go(page, '/salon');
  await page.getByRole('button', { name: /^Mesa 1:/ }).click();
  m = dialog(page);
  await m.getByRole('button', { name: 'Cobrar', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Cobrar · Mesa 1' }).getByRole('button', { name: /^Cobrar .* y cerrar$/ }).click();
  await expect(page.getByText('Mesa 1: cobrado y cerrado')).toBeVisible();
  await go(page, '/salon?vista=hoy');
  await page.getByRole('button', { name: 'Cierre del día' }).click();
  m = page.getByRole('dialog', { name: 'Cierre del día' });
  await expect(m.getByRole('table', { name: 'Resumen del cierre' })).toContainText(/8\.500/);
  await expect(m.getByRole('row', { name: /Cobrado sin factura/ })).toContainText(/8\.500/);
  await expect(m.getByRole('button', { name: 'Imprimir cierre' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Libro IVA (sin comprobantes autorizados todavía).
  await go(page, '/comprobantes');
  await page.getByRole('group', { name: 'Ver comprobantes' }).getByRole('button', { name: 'Libro IVA' }).click();
  await expect(page.getByText('Sin comprobantes autorizados en este mes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar Excel' })).toBeDisabled();
});

test('stock inteligente: consumo, para cuántos días alcanza y pedido según consumo', async ({ page }) => {
  await loadDemo(page);
  // Una salida de 20 servilletas hoy: consumo de 20 en el período.
  await go(page, '/stock');
  await page.getByRole('article', { name: 'Servilletas' }).getByRole('button', { name: /Registrar movimiento/ }).click();
  const m = dialog(page);
  await m.getByLabel('Tipo de movimiento').selectOption('salida');
  await m.getByLabel('Cantidad').fill('20');
  await m.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByRole('article', { name: 'Servilletas' })).toContainText(/Usás .*\/día · alcanza/);

  await page.getByRole('link', { name: 'Consumo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consumo y mermas', level: 1 })).toBeVisible();
  await expect(page.getByRole('row', { name: /Servilletas/ })).toContainText('20');

  await go(page, '/pedidos');
  await page.getByRole('button', { name: 'Pedido sugerido' }).click();
  const d = dialog(page);
  await d.getByRole('group', { name: 'Cantidad sugerida' }).getByRole('button', { name: 'Según consumo' }).click();
  await expect(d.getByLabel('Días a cubrir')).toHaveValue('7');
  await expect(d.getByText(/según el consumo real del último mes/)).toBeVisible();
});

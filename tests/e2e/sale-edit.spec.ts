import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('ventas: corregir una venta cerrada (medio de pago, datos, anular) con motivo e historial, como Fudo', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/salon');
  await page.getByLabel('Cantidad de mesas').fill('2');
  await page.getByRole('button', { name: 'Crear mesas' }).click();
  await go(page, '/salon?vista=carta');
  await page.getByRole('button', { name: 'Agregar el primero' }).click();
  let m = dialog(page);
  await m.getByLabel('Nombre').fill('Milanesa');
  await m.getByLabel('Sección').fill('Platos');
  await m.getByLabel('Precio', { exact: true }).fill('9000');
  await m.getByLabel('Va a la pantalla de cocina').setChecked(false);
  await m.getByRole('button', { name: 'Guardar', exact: true }).click();

  // Una venta cobrada en efectivo.
  await go(page, '/salon');
  await page.getByRole('button', { name: 'Mesa 1: Libre' }).click();
  m = dialog(page);
  await m.getByRole('button', { name: 'Agregar Milanesa' }).click();
  if (!(await m.getByRole('region', { name: 'Pedido' }).isVisible())) await m.getByRole('group', { name: 'Ver' }).getByRole('button', { name: /^Pedido/ }).click();
  await m.getByRole('button', { name: /^Mandar a cocina/ }).click();
  await m.getByRole('button', { name: 'Cobrar', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Cobrar · Mesa 1' }).getByRole('button', { name: /^Cobrar .* y cerrar$/ }).click();
  await expect(page.getByText('Mesa 1: cobrado y cerrado')).toBeVisible();

  // Ventas de hoy → el pedido → cambiar el medio de pago (con motivo obligatorio).
  await go(page, '/salon?vista=hoy');
  await expect(page.getByLabel('Día')).toBeVisible();
  await page.getByRole('button', { name: /^Mesa 1 · #/ }).click();
  const detail = page.getByRole('dialog', { name: /^Mesa 1 · #/ });
  await detail.getByRole('button', { name: 'Cambiar medio de pago' }).click();
  const pay = page.getByRole('dialog', { name: 'Cambiar medio de pago' });
  await pay.getByLabel('Medio de pago 1').selectOption('debito');
  await pay.getByRole('button', { name: 'Guardar cambio' }).click();
  await expect(page.getByText('Escribí el motivo del cambio.')).toBeVisible();
  await pay.getByLabel('Motivo').fill('Pagó con débito');
  await pay.getByRole('button', { name: 'Guardar cambio' }).click();
  await expect(page.getByText('Medio de pago cambiado')).toBeVisible();
  const history = detail.getByRole('region', { name: 'Cambios' });
  await expect(history).toContainText('Medio de pago');
  await expect(history).toContainText('Pagó con débito');
  await expect(history).toContainText(/Efectivo .*→ Débito/);
  await expect(detail.getByText(/Débito \$/).first()).toBeVisible();

  // Anular la venta: deja de contar y queda en el historial.
  await detail.getByRole('button', { name: 'Anular venta' }).click();
  const anular = page.getByRole('dialog', { name: 'Anular la venta' });
  await anular.getByLabel('Motivo').fill('Se cargó por error');
  await anular.getByRole('button', { name: 'Anular venta' }).click();
  await expect(page.getByText('Venta anulada')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /ANULADA$/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listitem').filter({ hasText: /^Mesa 1 · #/ })).toContainText('Anulado');
  await expect(page.locator('.salon-stat').first()).toContainText('$ 0');
});

test('usuarios: los permisos para corregir y anular ventas cerradas se dan por persona', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mismo permiso en el celular');
  await loadDemo(page);
  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Mozo');
  await d.getByLabel(/^PIN( ·|$)/).fill('1357');
  await d.getByLabel('Repetí el PIN').fill('1357');
  await d.getByLabel('Rol').selectOption('custom');
  await expect(d.getByLabel(/Editar ventas cerradas/)).toBeVisible();
  await expect(d.getByLabel(/Anular ventas cerradas/)).toBeVisible();
});

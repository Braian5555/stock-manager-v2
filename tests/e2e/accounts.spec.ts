import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('cuenta corriente: cerrar una mesa a la cuenta de un cliente y registrar su pago', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/salon');
  await page.getByLabel('Cantidad de mesas').fill('2');
  await page.getByRole('button', { name: 'Crear mesas' }).click();
  await go(page, '/salon?vista=carta');
  await page.getByRole('button', { name: 'Agregar el primero' }).click();
  let m = dialog(page);
  await m.getByLabel('Nombre').fill('Café con leche');
  await m.getByLabel('Sección').fill('Cafetería');
  await m.getByLabel('Precio').fill('3000');
  await m.getByLabel('Va a la pantalla de cocina').uncheck();
  await m.getByRole('button', { name: 'Guardar', exact: true }).click();

  // Caja abierta
  await go(page, '/salon?vista=caja');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByText('Caja abierta')).toBeVisible();

  // Mesa 1: 2 cafés a la cuenta de ALADES (cliente creado al cobrar).
  await go(page, '/salon');
  await page.getByRole('button', { name: 'Mesa 1: Libre' }).click();
  m = dialog(page);
  await m.getByRole('button', { name: 'Agregar Café con leche' }).click();
  await m.getByRole('button', { name: 'Agregar Café con leche' }).click();
  await m.getByRole('button', { name: /^Mandar a cocina/ }).click();
  await m.getByRole('button', { name: 'Cobrar', exact: true }).first().click();
  const pay = page.getByRole('dialog', { name: 'Cobrar · Mesa 1' });
  await pay.getByLabel('Medio de pago 1').selectOption('cuenta_corriente');
  await pay.getByLabel('Cliente de cuenta corriente 1').selectOption('__nuevo');
  await pay.getByLabel('Nombre del cliente nuevo').fill('ALADES');
  await pay.getByRole('button', { name: 'Agregar' }).click();
  await expect(pay.getByLabel('Cliente de cuenta corriente 1')).toHaveValue(/.+/);
  await pay.screenshot({ path: 'test-results/cobro-cuenta-corriente.png' });
  await pay.getByRole('button', { name: /Cerrar mesa/ }).click();
  await expect(page.getByText('Mesa 1: cobrado y cerrado')).toBeVisible();

  // La caja no suma esa plata.
  await go(page, '/salon?vista=caja');
  await expect(page.getByText('a cuenta corriente (no entra en caja)')).toBeVisible();

  // Cuentas corrientes: debe 6.000 y paga.
  await go(page, '/salon?vista=cuentas');
  await expect(page.getByRole('heading', { name: 'Cuentas corrientes', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^ALADES cargado/ })).toBeVisible();
  await expect(page.getByText(/Total a cobrar: \$\s?6\.000/)).toBeVisible();
  await page.screenshot({ path: 'test-results/cuentas-corrientes.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Pago' }).click();
  const pm = page.getByRole('dialog', { name: 'Pago de ALADES' });
  await pm.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByText('Pago registrado')).toBeVisible();
  await expect(page.getByText(/Total a cobrar: \$\s?0/)).toBeVisible();
});

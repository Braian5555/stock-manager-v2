import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('inicio: encabezado con resumen, accesos, indicadores y el día del negocio con datos reales', async ({ page, isMobile }) => {
  await loadDemo(page);
  // Actividad real de hoy: una producción anotada.
  await go(page, '/produccion');
  await page.getByLabel('Buscar producto').fill('Harina');
  await page.getByRole('listitem').filter({ hasText: 'Harina 000' }).click();
  await dialog(page).getByRole('button', { name: '+5' }).click();
  await dialog(page).getByRole('button', { name: /^Anotar 5 kg/ }).click();
  await expect(page.getByText('Anotado: 5 kg de Harina 000')).toBeVisible();
  await go(page, '/');

  // Encabezado: saludo con el nombre y resumen de hoy.
  await expect(page.getByRole('heading', { level: 1, name: /^(Buen día|Buenas tardes|Buenas noches), Admin$/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Resumen de hoy' })).toContainText('1 producto anotado en panadería');

  // Accesos rápidos según permisos (administrador: todos).
  const actions = page.getByRole('navigation', { name: 'Acciones rápidas' });
  for (const a of ['Anotar producción', 'Vitrina', 'Foto de factura', 'Contar stock', 'Ver stock']) await expect(actions.getByRole('link', { name: new RegExp(`^${a}`) })).toBeVisible();
  // Buscar: en el celular como acceso; en la computadora ya está en la barra de arriba.
  if (isMobile) await expect(actions.getByRole('button', { name: /^Buscar producto/ })).toBeVisible();
  else await expect(actions.getByRole('button', { name: /^Buscar producto/ })).toBeHidden();

  // Indicadores y secciones con los datos reales.
  await expect(page.getByRole('link', { name: /^Panadería hoy/ })).toContainText('1');
  const bakery = page.getByRole('region', { name: 'Panadería de hoy' });
  await expect(bakery).toContainText('Harina 000');
  await expect(bakery).toContainText('Admin Prueba');
  const activity = page.getByRole('region', { name: 'Actividad reciente' });
  await expect(activity).toContainText('Producción');
  await expect(activity).toContainText('+5 kg');
  const restock = page.getByRole('region', { name: 'Para reponer' });
  await expect(restock).toContainText('Papa');
  await expect(page.getByRole('region', { name: 'Vitrina' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Facturas de la semana' })).toContainText('No se cargaron facturas');
  for (const h of ['Pedidos abiertos', 'Remitos sin cargar en Maxirest']) await expect(page.getByRole('heading', { name: h })).toHaveCount(0);

  if (isMobile) {
    await expect(page.getByRole('button', { name: 'Bloquear / cambiar usuario' })).toBeVisible();
    await actions.getByRole('button', { name: /^Buscar producto/ }).click();
    await expect(page.getByRole('dialog', { name: 'Buscar' })).toBeVisible();
    await page.keyboard.press('Escape');
    await actions.getByRole('link', { name: /^Contar stock/ }).click();
    await expect(page).toHaveURL(/#\/conteo$/);
  } else {
    // Un producto para reponer lleva a Stock ya buscado.
    await restock.getByRole('link', { name: /Papa/ }).first().click();
    await expect(page).toHaveURL(/#\/stock\?q=Papa/);
    await expect(page.getByRole('searchbox').first()).toHaveValue('Papa');
  }
});

test('inicio: el encargado sin facturas ni producción ve sólo lo que puede usar', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mismo contenido en el celular');
  await loadDemo(page);
  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Cajero');
  await d.getByLabel(/^PIN( ·|$)/).fill('1357');
  await d.getByLabel('Repetí el PIN').fill('1357');
  await d.getByLabel('Rol').selectOption('staff');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Cajero', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Usuario:/ }).click();
  await page.getByRole('menuitem', { name: 'Bloquear / cambiar usuario' }).click();
  const { login } = await import('./helpers');
  await login(page, 'Cajero', '1357');
  await go(page, '/');
  const actions = page.getByRole('navigation', { name: 'Acciones rápidas' });
  await expect(actions.getByRole('link', { name: /^Contar stock/ })).toBeVisible();
  for (const a of ['Anotar producción', 'Vitrina']) await expect(actions.getByRole('link', { name: new RegExp(`^${a}`) })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Panadería de hoy' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Vitrina' })).toHaveCount(0);
});

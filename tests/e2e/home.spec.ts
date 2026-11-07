import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('inicio: ahora, menú completo (Salón primero), accesos y lo del día con datos reales', async ({ page, isMobile }) => {
  await loadDemo(page);
  // Actividad real de hoy: una producción anotada.
  await go(page, '/produccion');
  await page.getByLabel('Buscar producto').fill('Harina');
  await page.getByRole('listitem').filter({ hasText: 'Harina 000' }).click();
  await dialog(page).getByRole('button', { name: '+5' }).click();
  await dialog(page).getByRole('button', { name: /^Anotar 5 kg/ }).click();
  await expect(page.getByText('Anotado: 5 kg de Harina 000')).toBeVisible();
  await go(page, '/');

  // Encabezado: iniciales y saludo con el nombre.
  await expect(page.getByRole('heading', { level: 1, name: /^(Buen día|Buenas tardes|Buenas noches), Admin$/ })).toBeVisible();

  // Hoy: ventas del día y cómo está el negocio; cada dato lleva a donde se resuelve.
  const now = page.getByRole('region', { name: 'Hoy' });
  await expect(now.getByRole('link', { name: /vendido hoy/ })).toBeVisible();
  await expect(now.getByRole('link', { name: /ticket promedio/ })).toBeVisible();
  await expect(now.getByRole('link', { name: /en negativo/ })).toBeVisible();
  await expect(now.getByRole('link', { name: /para reponer/ })).toBeVisible();
  await expect(now.getByRole('link', { name: /en la cámara/ })).toBeVisible();
  await expect(now.getByRole('link', { name: /mesas ocupadas|Armar las mesas/ })).toBeVisible();
  await expect(now.getByRole('link', { name: /caja/ })).toContainText('Cerrada');

  // Menú agrupado como en Fudo: Ventas, Productos, Stock, Compras y gastos, Reportes, Administración.
  const groups = page.getByRole('navigation', { name: /^Menú: / });
  await expect(groups).toHaveCount(6);
  await expect(groups.first()).toHaveAccessibleName('Menú: Ventas');
  const menu = (g: string) => page.getByRole('navigation', { name: `Menú: ${g}` });
  for (const n of ['Mesas', 'Mostrador', 'Cocina', 'Caja', 'Ventas de hoy', 'Comprobantes']) await expect(menu('Ventas').getByRole('link', { name: n, exact: true })).toBeVisible();
  for (const n of ['Carta', 'Productos e insumos']) await expect(menu('Productos').getByRole('link', { name: n, exact: true })).toBeVisible();
  for (const n of ['Stock', 'Conteo', 'Movimientos', 'Panadería', 'Cámara']) await expect(menu('Stock').getByRole('link', { name: n, exact: true })).toBeVisible();
  for (const n of ['Facturas', 'Pedidos', 'Proveedores']) await expect(menu('Compras y gastos').getByRole('link', { name: n, exact: true })).toBeVisible();
  for (const n of ['Reportes', 'Consumo y mermas']) await expect(menu('Reportes').getByRole('link', { name: n, exact: true })).toBeVisible();
  for (const n of ['Configuración del salón', 'Configuración general', 'Usuarios']) await expect(menu('Administración').getByRole('link', { name: n, exact: true })).toBeVisible();

  // Accesos rápidos según permisos (administrador: todos).
  const actions = page.getByRole('navigation', { name: 'Acciones rápidas' });
  for (const a of ['Mesas', 'Mostrador', 'Cocina', 'Caja', 'Anotar producción', 'Cámara', 'Foto de factura', 'Contar stock', 'Ver stock']) await expect(actions.getByRole('link', { name: new RegExp(`^${a}`) })).toBeVisible();

  // Lo del día: panadería y para reponer.
  const bakery = page.getByRole('region', { name: 'Panadería de hoy' });
  await expect(bakery).toContainText('Harina 000');
  await expect(bakery).toContainText('Admin Prueba');
  const restock = page.getByRole('region', { name: 'Para reponer' });
  await expect(restock).toContainText('Papa');

  if (isMobile) {
    await expect(page.getByRole('button', { name: 'Bloquear / cambiar usuario' })).toBeVisible();
    await page.getByRole('button', { name: 'Buscar (Ctrl+K)' }).click();
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
  for (const a of ['Anotar producción', 'Cámara']) await expect(actions.getByRole('link', { name: new RegExp(`^${a}`) })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Panadería de hoy' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Menú: Stock' }).getByRole('link', { name: 'Panadería', exact: true })).toHaveCount(0);
});

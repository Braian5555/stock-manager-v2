import { expect, test } from '@playwright/test';
import { go, loadDemo } from './helpers';

const ROUTES: [string, RegExp][] = [
  ['/', /^(Inicio|Hola)/], ['/stock', /Stock/], ['/productos', /Productos/], ['/conteo', /Conteo/], ['/pedidos', /Pedidos/],
  ['/facturas', /Facturas/], ['/remitos', /Remitos/], ['/proveedores', /Proveedores/], ['/ubicaciones', /Ubicaciones/],
  ['/familias', /Familias/], ['/unidades', /Unidades/], ['/movimientos', /Movimientos/], ['/conciliacion', /Conciliación/],
  ['/exportar', /Exportar/], ['/integraciones', /Integraciones/], ['/nube', /Cuenta y nube/], ['/usuarios', /Usuarios/],
  ['/configuracion', /Configuración/], ['/reportes', /Reportes/], ['/ayuda', /Ayuda/], ['/acerca', /Información/], ['/mas', /Más/],
  ['/configuracion/empresa', /Empresa y apariencia/], ['/configuracion/navegacion', /Menú y navegación/], ['/configuracion/stock', /Stock/],
  ['/configuracion/productos', /Productos/], ['/configuracion/pedidos', /Pedidos y compras/], ['/configuracion/usuarios', /Usuarios/],
  ['/configuracion/nube', /Cuenta y nube/], ['/configuracion/integraciones', /Integraciones/], ['/configuracion/datos', /Exportar/],
  ['/configuracion/aplicacion', /Aplicación/], ['/configuracion/diagnostico', /Diagnóstico/],
];

test('todas las rutas existentes y nuevas abren sin errores', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loadDemo(page);
  for (const [hash, title] of ROUTES) {
    await go(page, hash);
    await expect(page.locator('main h1').first(), hash).toHaveText(title);
  }
  expect(errors).toEqual([]);
});

test('reportes muestra la actividad del período', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/reportes');
  await expect(page.getByText('Ingresos registrados')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lo que más ingresó' }).getByText('Servilletas')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Estado por familia' })).toBeVisible();
  await page.getByRole('button', { name: '7 días' }).click();
  await expect(page.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true');
});

test('configuración: qué módulos van en cada barra', async ({ page, isMobile }) => {
  await loadDemo(page);
  await go(page, '/configuracion');
  for (const t of ['Empresa y apariencia', 'Menú y navegación', 'Usuarios y permisos', 'Cuenta y nube', 'Integraciones', 'Importar y exportar', 'Aplicación', 'Diagnóstico'])
    await expect(page.getByRole('link', { name: new RegExp(t) }).first()).toBeVisible();
  await go(page, '/configuracion/navegacion');
  if (isMobile) {
    // Cambiar Movimientos por Conteo en la barra inferior
    await page.getByLabel('Movimientos en la barra del celular').click();
    await expect(page.getByLabel('Movimientos en la barra del celular')).not.toBeChecked();
    await page.getByLabel('Conteo en la barra del celular').click();
    await expect(page.getByLabel('Conteo en la barra del celular')).toBeChecked();
    const bottom = page.getByRole('navigation', { name: 'Navegación inferior' });
    await expect(bottom.getByRole('link', { name: 'Conteo' })).toBeVisible();
    await expect(bottom.getByRole('link', { name: 'Movimientos' })).toHaveCount(0);
  } else {
    // En la computadora las secciones están todas en la barra lateral: ocultar un módulo lo saca.
    const top = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(top.getByRole('link', { name: 'Remitos' })).toBeVisible();
    await page.getByRole('button', { name: /^Ocultar Remitos/ }).click();
    await expect(top.getByRole('link', { name: 'Remitos' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Mostrar Remitos/ }).click();
    await expect(top.getByRole('link', { name: 'Remitos' })).toBeVisible();
  }
});

test('computadora: la sección activa y sus pestañas siguen a la página', async ({ page, isMobile }) => {
  test.skip(isMobile, 'sólo computadora');
  await loadDemo(page);
  const side = page.getByRole('navigation', { name: 'Navegación principal' });
  await go(page, '/movimientos');
  await expect(side.getByRole('link', { name: 'Stock' })).toHaveClass(/active/);
  const tabs = page.getByRole('navigation', { name: /^Pestañas de / });
  await expect(tabs.getByRole('link', { name: 'Movimientos' })).toHaveClass(/active/);
  await tabs.getByRole('link', { name: 'Conteo' }).click();
  await expect(page).toHaveURL(/#\/conteo$/);
  await expect(side.getByRole('link', { name: 'Stock' })).toHaveClass(/active/);
  // Sin scroll horizontal en ningún ancho de computadora
  for (const width of [1024, 1280, 1366, 1920]) {
    await page.setViewportSize({ width, height: 760 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `ancho ${width}`).toBeLessThanOrEqual(0);
  }
});

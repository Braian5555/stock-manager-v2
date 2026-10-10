import { expect, test } from '@playwright/test';
import { go, loadDemo, open } from './helpers';

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
    await page.getByLabel('Reportes en la barra de la computadora').click();
    await expect(page.getByLabel('Reportes en la barra de la computadora')).not.toBeChecked();
    const top = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(top.getByRole('link', { name: 'Reportes' })).toHaveCount(0);
    await top.getByRole('button', { name: /Más/ }).click();
    await expect(page.getByRole('region', { name: 'Más secciones' }).getByRole('link', { name: 'Reportes' })).toBeVisible();
  }
});

test('computadora: el panel "Más" se cierra al cambiar de página', async ({ page, isMobile }) => {
  test.skip(isMobile, 'sólo computadora');
  await loadDemo(page);
  const top = page.getByRole('navigation', { name: 'Navegación principal' });
  await top.getByRole('button', { name: /Más/ }).click();
  const panel = page.getByRole('region', { name: 'Más secciones' });
  await expect(panel).toBeVisible();
  await go(page, '/stock');
  await expect(panel).toHaveCount(0);
  await expect(top.getByRole('link', { name: 'Stock' })).toHaveClass(/active/);
});

test('computadora: el panel "Más" entra entero en la pantalla en cualquier ancho y se puede elegir', async ({ page, isMobile }) => {
  test.skip(isMobile, 'el panel es de la barra de computadora');
  await open(page);
  for (const width of [1024, 1180, 1366, 1600, 1920]) {
    await page.setViewportSize({ width, height: 760 });
    await page.getByRole('banner').getByRole('button', { name: /Más/ }).click();
    const panel = page.getByRole('region', { name: 'Más secciones' });
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x, `ancho ${width}`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `ancho ${width}`).toBeLessThanOrEqual(width);
    // Sin scroll horizontal en la página
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `ancho ${width}`).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('banner').getByRole('button', { name: /Más/ }).click();
  await page.getByRole('region', { name: 'Más secciones' }).getByRole('link', { name: 'Información de la aplicación' }).click();
  await expect(page).toHaveURL(/#\/acerca$/);
});

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialog, go, loadDemo, open } from './helpers';

const BASE = process.env.VITE_BASE_PATH ?? '/';

test('1 · abre la app sin mostrar código fuente ni errores', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByRole('heading', { name: /^(Inicio|Hola)/, level: 1 })).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/import\s|export\s|function\s*\(|=>|React\.|createElement|<\/?script/);
  expect(await page.locator('script:not([src])').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('2-5 · crea producto y proveedor, los relaciona y cambia el stock', async ({ page }) => {
  await open(page);
  await go(page, '/proveedores');
  await page.getByRole('button', { name: 'Nuevo proveedor' }).click();
  await dialog(page).getByLabel('Nombre').fill('Proveedor Test');
  await dialog(page).getByLabel('Teléfono').fill('+54 11 1234-5678');
  await dialog(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Proveedor Test')).toBeVisible();

  await go(page, '/productos');
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Hielo 10 kg');
  await d.getByLabel('Código / SKU').fill('HIE-T');
  await d.getByLabel('Familia').selectOption({ label: 'Hielo' });
  await d.getByLabel('Unidad de stock').selectOption({ label: 'Bolsa (bolsa)' });
  await d.getByLabel('Proveedor principal').selectOption({ label: 'Proveedor Test' });
  await d.getByLabel('Stock mínimo').fill('8');
  await d.getByLabel('Stock máximo').fill('20');
  await d.getByLabel('Stock inicial').fill('5');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(d).toBeHidden();
  await expect(page).toHaveURL(/#\/productos$/);
  await expect(page.locator('td.cell-title', { hasText: 'Hielo 10 kg' })).toBeVisible();

  await go(page, '/stock');
  const card = page.getByRole('article', { name: 'Hielo 10 kg' });
  await expect(card).toContainText('Proveedor Test');
  await expect(card).toContainText('Stock bajo');
  await card.getByRole('button', { name: 'Registrar movimiento' }).click();
  await dialog(page).getByLabel('Cantidad').fill('10');
  await expect(dialog(page)).toContainText('nuevo 15');
  await dialog(page).getByRole('button', { name: 'Registrar' }).click();
  await expect(card.locator('.pcard-qty strong')).toHaveText('15');
  await expect(card).toContainText('Normal');

  // Deshacer
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(card.locator('.pcard-qty strong')).toHaveText('5');
});

test('6-7 · conteo detecta y aplica diferencias', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/conteo');
  await page.getByRole('button', { name: 'Nuevo conteo' }).click();
  await dialog(page).getByLabel('Ubicación').selectOption({ label: 'Cámara de verduras' });
  await dialog(page).getByRole('button', { name: 'Empezar conteo' }).click();
  await expect(page.getByText('0 de 2 contados')).toBeVisible();
  // Papa: esperado 0 → cuenta 3 con el botón +
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Sumar 1 a Papa' }).click();
  await page.getByLabel('Cantidad contada de Tomate').fill('7');
  await expect(page.getByText('2 de 2 contados')).toBeVisible();
  await page.getByRole('button', { name: 'Finalizar conteo' }).click();
  const result = page.locator('section', { has: page.getByRole('heading', { name: 'Resultado' }) });
  await expect(result.locator('.stat', { hasText: 'Aumentos' }).locator('.stat-value')).toHaveText('1');
  await expect(result.locator('.stat', { hasText: 'Disminuciones' }).locator('.stat-value')).toHaveText('1');
  await page.getByRole('button', { name: 'Aplicar al stock' }).click();
  await dialog(page).getByRole('button', { name: 'Aplicar ajustes' }).click();
  await expect(page.getByText('Conteo aplicado: 2 ajustes registrados.')).toBeVisible();
  await go(page, '/movimientos');
  await expect(page.locator('tbody tr, .list-item').filter({ visible: true }).first()).toContainText('Conteo');
});

test('8-10 · crea un pedido, lo recibe y suma stock con movimiento', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/pedidos/nuevo');
  await page.getByLabel('Proveedor').selectOption({ label: 'Carnicería Ejemplo' });
  await page.getByRole('button', { name: 'Agregar producto' }).click();
  await page.getByLabel('Producto', { exact: true }).selectOption({ label: 'Carne picada' });
  await page.getByLabel(/^Cantidad/).fill('10');
  await page.getByRole('button', { name: 'Guardar como pendiente' }).click();
  await expect(page.getByRole('heading', { name: 'Pedido #1' })).toBeVisible();
  await page.getByRole('button', { name: 'Recibir' }).click();
  await expect(dialog(page)).toContainText('Stock anterior: 2 · Pedido recibido: +10 · Stock nuevo: 12');
  await dialog(page).getByRole('button', { name: 'Confirmar recepción' }).click();
  await expect(page.getByText('Recibido').first()).toBeVisible();
  await go(page, '/movimientos');
  const row = page.locator('tbody tr, .list-item', { hasText: 'Carne picada' }).filter({ visible: true }).first();
  await expect(row).toContainText('Pedido #1');
  await expect(row).toContainText('+10');
});

test('11-12 · los datos persisten al cerrar y volver a abrir', async ({ page, context }) => {
  await loadDemo(page);
  await page.close();
  const again = await context.newPage();
  await again.goto('./#/productos');
  await expect(again.locator('td.cell-title', { hasText: 'Harina 000' })).toBeVisible();
});

test('13-14 · exporta y restaura backup JSON (con confirmación)', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/exportar');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar backup' }).click()]);
  const file = join(tmpdir(), `sm-backup-${Date.now()}.json`);
  await dl.saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup.format).toBe('stock-manager-backup');
  expect(backup.tables.products).toHaveLength(15);
  expect(JSON.stringify(backup)).not.toMatch(/password|token|apiKey/i);

  await go(page, '/productos');
  await page.getByRole('button', { name: 'Eliminar Sal fina' }).click();
  await dialog(page).getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.locator('td.cell-title', { hasText: 'Sal fina' })).toHaveCount(0);

  await go(page, '/exportar');
  await page.getByLabel('Archivo de backup').setInputFiles(file);
  await expect(dialog(page)).toContainText('Esta acción reemplazará los datos actuales.');
  await dialog(page).getByRole('button', { name: 'Reemplazar datos' }).click();
  await expect(page.getByText('Copia restaurada correctamente')).toBeVisible();
  await go(page, '/productos');
  await expect(page.locator('td.cell-title', { hasText: 'Sal fina' })).toBeVisible();
});

test('15-17 · exporta Excel, PDF y Word válidos', async ({ page }, info) => {
  await loadDemo(page);
  await go(page, '/exportar');
  for (const [label, magic] of [['Excel (XLSX)', 'PK'], ['PDF', '%PDF'], ['Word (DOCX)', 'PK']] as const) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
    const p = info.outputPath(dl.suggestedFilename());
    await dl.saveAs(p);
    expect(readFileSync(p).subarray(0, magic.length).toString()).toBe(magic);
    expect(readFileSync(p).length).toBeGreaterThan(2000);
  }
});

test('18-19 · PWA instalable y funciona offline', async ({ page, context }) => {
  await open(page);
  const manifest = await (await page.request.get('manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ start_url: BASE, scope: BASE, display: 'standalone' });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', `${BASE}manifest.webmanifest`);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe(BASE);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: 'Cargar datos de ejemplo' }).click();
  await expect(page.getByText('Datos de ejemplo cargados')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^(Inicio|Hola)/, level: 1 })).toBeVisible();
  await expect(page.getByText(/Sin conexión/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Estado: Sin conexión/ }).or(page.getByRole('status', { name: /Estado: Sin conexión/ })).first()).toBeVisible();
  await page.goto('./#/stock');
  await expect(page.getByRole('article', { name: 'Harina 000' })).toBeVisible();
  // Una pantalla con carga diferida (lazy) también funciona offline
  await page.goto('./#/exportar');
  await expect(page.getByRole('button', { name: 'Exportar backup' })).toBeVisible();
  await context.setOffline(false);
});

test('20-21 · alertas de stock bajo y pedido sugerido agrupado por proveedor', async ({ page }) => {
  await loadDemo(page);
  await expect(page.getByRole('link', { name: /4 productos tienen stock bajo/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /2 productos están sin stock/ })).toBeVisible();
  await page.getByRole('link', { name: 'Crear pedido sugerido' }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Carnicería Ejemplo' })).toBeVisible();
  // Carne picada: stock 2, mín 10, máx 30 → 28
  await expect(d.getByLabel('Cantidad a pedir de Carne picada')).toHaveValue('28');
  await d.getByRole('button', { name: 'Crear pedidos' }).click();
  await expect(page.getByText(/pedidos creados en borrador/)).toBeVisible();
});

test('22-23 · navegación adaptada al dispositivo', async ({ page, isMobile }) => {
  await open(page);
  if (isMobile) {
    const bottom = page.getByRole('navigation', { name: 'Navegación inferior' });
    await expect(bottom).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeHidden();
    for (const l of ['Inicio', 'Stock', 'Pedidos', 'Movimientos', 'Más']) await expect(bottom.getByRole('link', { name: l })).toBeVisible();
    await bottom.getByRole('link', { name: 'Más' }).click();
    await expect(page.getByRole('heading', { name: 'Operación diaria' })).toBeVisible();
    await page.getByRole('link', { name: 'Configuración' }).click();
  } else {
    const top = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(top).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación inferior' })).toBeHidden();
    for (const l of ['Inicio', 'Stock', 'Productos', 'Conteo', 'Pedidos', 'Movimientos', 'Remitos', 'Proveedores', 'Facturas', 'Reportes']) await expect(top.getByRole('link', { name: l })).toBeVisible();
    await expect(top.getByRole('link', { name: 'Inicio' })).toHaveClass(/active/);
    // "Más" abre el resto agrupado
    await top.getByRole('button', { name: /Más/ }).click();
    await expect(page.getByRole('region', { name: 'Más secciones' }).getByRole('link', { name: 'Familias' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Configuración' }).first().click();
  }
  await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('personalización: nombre, menú renombrado y tema oscuro', async ({ page }) => {
  await open(page);
  await go(page, '/configuracion/empresa');
  await page.getByLabel('Nombre del negocio').fill('Mi Negocio');
  await page.getByLabel('Nombre del negocio').blur();
  await page.getByRole('button', { name: 'Oscuro' }).click();
  await go(page, '/configuracion/navegacion');
  await page.getByLabel('Nombre del menú stock').fill('Inventario');
  await page.getByLabel('Nombre del menú stock').blur();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByText('Mi Negocio').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inventario' }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('búsqueda global encuentra productos por código', async ({ page }) => {
  await loadDemo(page);
  await page.getByRole('button', { name: 'Buscar (Ctrl+K)' }).click();
  await dialog(page).getByLabel('Búsqueda global').fill('HIE-005');
  await dialog(page).getByRole('option', { name: /Hielo 5 kg/ }).click();
  await expect(dialog(page).getByLabel('Nombre')).toHaveValue('Hielo 5 kg');
});

test('navegar no falla aunque scrollTo devuelva una Promise (Chrome reciente)', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.scrollTo.bind(window);
    (window as unknown as { scrollTo: (...a: unknown[]) => unknown }).scrollTo = (...a: unknown[]) => {
      original(...(a as [number, number]));
      return Promise.resolve();
    };
  });
  await open(page);
  // Navegación del lado del cliente con los links del menú (la que fallaba).
  for (const hash of ['/stock', '/movimientos', '/pedidos', '/']) {
    await page.locator(`a[href="#${hash}"]`).filter({ visible: true }).last().click();
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.getByText('Algo salió mal')).toHaveCount(0);
  }
});

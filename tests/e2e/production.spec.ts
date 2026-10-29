import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo, login } from './helpers';

test('producción: usuario panadero ve sólo Producción, anota con dos toques y suma al stock', async ({ page, isMobile }) => {
  await loadDemo(page);
  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Panadero');
  await d.getByLabel(/^PIN( ·|$)/).fill('2468');
  await d.getByLabel('Repetí el PIN').fill('2468');
  await d.getByLabel('Rol').selectOption('production');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Panadero', { exact: true })).toBeVisible();

  if (isMobile) {
    await go(page, '/mas');
    await page.getByRole('button', { name: 'Bloquear / cambiar usuario' }).click();
  } else {
    await page.getByRole('button', { name: /^Usuario:/ }).click();
    await page.getByRole('menuitem', { name: 'Bloquear / cambiar usuario' }).click();
  }
  await login(page, 'Panadero', '2468');

  // Entra directo a Producción; la navegación sólo ofrece Producción (Pastelería es de la pastelera).
  await expect(page.getByRole('heading', { name: 'Producción', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/produccion$/);
  const nav = page.getByRole('navigation', { name: isMobile ? 'Navegación inferior' : 'Navegación principal' });
  await expect(nav.getByRole('link', { name: 'Producción' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Pastelería' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Stock' })).toHaveCount(0);

  // Busca, toca y anota 12
  await page.getByLabel('Buscar producto').fill('Harina');
  await page.getByRole('listitem').filter({ hasText: 'Harina 000' }).click();
  const m = dialog(page);
  await m.getByRole('button', { name: '+5' }).click();
  await m.getByRole('button', { name: '+1', exact: true }).click();
  await m.getByRole('button', { name: /^Anotar 6 kg/ }).click();
  await expect(page.getByText('Anotado: 6 kg de Harina 000')).toBeVisible();
  const today = page.locator('section', { has: page.getByRole('heading', { name: 'Anotado hoy' }) });
  await expect(today).toContainText('Harina 000');
  await expect(today).toContainText('+6');
  await expect(today).toContainText('Panadero');

  // El panadero ve Anotar, Plan y Recetas (puede editarlas); el resumen y armar el plan son del encargado.
  const vista = page.getByRole('group', { name: 'Vista' });
  for (const v of ['Anotar', 'Plan', 'Recetas']) await expect(vista.getByRole('button', { name: v })).toBeVisible();
  for (const v of ['Resumen', 'Cierre']) await expect(vista.getByRole('button', { name: v })).toHaveCount(0);
  await vista.getByRole('button', { name: 'Plan' }).click();
  await expect(page.getByText('No hay plan para hoy')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Armar plan' })).toHaveCount(0);
  await vista.getByRole('button', { name: 'Anotar' }).click();

  // La próxima vez aparece en "Lo de siempre"
  await page.getByLabel('Buscar producto').fill('');
  await expect(page.getByRole('button', { name: 'Lo de siempre' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('listitem').filter({ hasText: 'Harina 000' })).toBeVisible();

  // Deshacer
  await today.getByRole('button', { name: /^Deshacer/ }).click();
  await expect(today).toContainText('deshecho');

  // Cualquier otra sección lo devuelve a Producción
  await page.goto('./#/stock');
  await expect(page).toHaveURL(/#\/produccion$/);
});

test('producción con receta: al anotar se descuentan los insumos del stock', async ({ page }) => {
  await loadDemo(page);
  const stockOf = (name: string) => page.evaluate(async (n) => {
    const open = indexedDB.open('stock-manager');
    const dbi: IDBDatabase = await new Promise((r) => { open.onsuccess = () => r(open.result); });
    const all: { name: string; stock: number }[] = await new Promise((r) => { const q = dbi.transaction('products').objectStore('products').getAll(); q.onsuccess = () => r(q.result); });
    return all.find((p) => p.name === n)!.stock;
  }, name);
  const before = await stockOf('Harina 000');

  // Receta: una tanda de 2 "Sal fina" lleva 1 kg de Harina 000
  await go(page, '/productos');
  await page.getByRole('button', { name: 'Editar Sal fina' }).click();
  const f = dialog(page);
  await f.getByLabel('Agregar insumo').fill('Harina 000');
  await f.getByLabel('Rinde').fill('2');
  await f.getByLabel('Cantidad de Harina 000').fill('1');
  await f.getByRole('button', { name: 'Guardar' }).click();
  await expect(f).toBeHidden();

  await go(page, '/produccion');
  await page.getByLabel('Buscar producto').fill('Sal fina');
  await page.getByRole('listitem').filter({ hasText: 'Sal fina' }).click();
  const m = dialog(page);
  await expect(m).toContainText('Harina 000');
  await m.getByLabel(/^Cantidad contada de/).fill('4');
  await expect(m).toContainText('Se descuenta del stock:');
  await expect(m.locator('.production-uses')).toContainText('2 kg');
  await m.getByRole('button', { name: /^Anotar 4/ }).click();
  await expect(page.getByText(/se descontaron 1 insumo/)).toBeVisible();
  await expect.poll(() => stockOf('Harina 000')).toBe(before - 2);

  // Deshacer devuelve la harina
  const today = page.locator('section', { has: page.getByRole('heading', { name: 'Anotado hoy' }) });
  await today.getByRole('button', { name: /^Deshacer/ }).click();
  await expect.poll(() => stockOf('Harina 000')).toBe(before);
});

test('recetas desde Producción: cargar, cambiar y quitar sin ir a Productos', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/produccion');
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Recetas' }).click();
  await page.getByLabel('Buscar receta').fill('Tomate');
  await page.getByRole('button', { name: /Tomate.*Sin receta/ }).click();
  let m = page.getByRole('dialog');
  await expect(m.getByRole('heading', { name: 'Receta: Tomate' })).toBeVisible();
  await m.getByLabel('Agregar insumo').fill('Sal fina');
  await expect(m.getByRole('button', { name: 'Guardar receta' })).toBeDisabled(); // falta la cantidad
  await m.getByLabel('Cantidad de Sal fina').fill('0,5');
  await m.getByRole('button', { name: 'Guardar receta' }).click();
  await expect(page.getByText('Receta guardada').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Tomate.*Rinde 1 kg · 1 insumo/ })).toBeVisible();

  // Desde Anotar: el producto muestra la receta y se puede editar ahí mismo.
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Anotar' }).click();
  await page.getByLabel('Buscar producto').fill('Tomate');
  await page.getByRole('listitem').filter({ hasText: 'Tomate' }).click();
  m = page.getByRole('dialog');
  await expect(m.locator('.production-uses')).toContainText('Sal fina');
  await m.getByRole('button', { name: 'Editar receta' }).click();
  m = page.getByRole('dialog');
  await m.getByLabel('Cantidad de Sal fina').fill('1');
  await m.getByRole('button', { name: 'Guardar receta' }).click();
  await expect(page.getByText('Receta guardada').first()).toBeVisible();

  // Quitar receta pide confirmación
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Recetas' }).click();
  await page.getByRole('button', { name: /Tomate/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Quitar receta' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Quitar receta' }).click();
  await expect(page.getByText('Receta quitada').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Tomate.*Sin receta/ })).toBeVisible();
});

test('panadería: plan del día y resumen con Excel', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/produccion');
  const vista = page.getByRole('group', { name: 'Vista' });

  // Armar el plan de hoy
  await vista.getByRole('button', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Armar plan' }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Buscar producto para el plan').fill('Sal fina');
  for (let i = 0; i < 4; i++) await d.getByRole('button', { name: 'Sumar 1 a Sal fina' }).click();
  await d.getByRole('button', { name: 'Guardar plan (1)' }).click();
  await expect(page.getByText('Plan guardado')).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Sal fina' });
  await expect(row).toContainText('0 / 4');

  // Tocar el producto del plan abre "Anotar" con lo que falta
  await row.click();
  d = page.getByRole('dialog');
  await expect(d.getByLabel(/^Cantidad contada de/)).toHaveValue('4');
  await d.getByRole('button', { name: /^Anotar 4/ }).click();
  await expect(row).toContainText('4 / 4');
  await expect(row.getByLabel('Listo')).toBeVisible();
  await expect(page.getByText('1 de 1 listos')).toBeVisible();

  // Resumen de hoy + Excel
  await vista.getByRole('button', { name: 'Resumen' }).click();
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Hoy' }).click();
  const r = page.getByRole('row').filter({ hasText: 'Sal fina' });
  await expect(r.getByRole('cell')).toHaveText([/Sal fina/, '4', '4', 'Admin Prueba']);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^panaderia-hoy-.*\.xlsx$/);
});

test('producción muestra sólo las familias elegidas (sin bebidas ni el resto)', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/produccion');
  // Sin familias de panadería en los datos de ejemplo se ve todo; el administrador elige cuáles.
  await page.getByRole('button', { name: 'Familias' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('checkbox', { name: 'Mostrar Almacén en Producción' }).check();
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Familias de producción guardadas')).toBeVisible();
  const grid = page.getByRole('list', { name: 'Productos' });
  await expect(grid.getByRole('listitem').filter({ hasText: 'Harina 000' })).toBeVisible();
  await page.getByLabel('Buscar producto').fill('Gaseosa');
  await expect(page.getByText('No hay productos con ese nombre.')).toBeVisible();
  await page.getByLabel('Buscar producto').fill('');
  await expect(grid.getByRole('listitem').filter({ hasText: 'Agua mineral' })).toHaveCount(0);
});

test('pastelería: sección propia con sus familias, separada de producción', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/pasteleria');
  await expect(page.getByRole('heading', { name: 'Pastelería', level: 1 })).toBeVisible();
  await expect(page.getByText('Todavía no hay familias de pastelería')).toBeVisible();
  await page.getByRole('button', { name: 'Elegir familias' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('checkbox', { name: 'Mostrar Almacén en Pastelería' }).check();
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Familias de pastelería guardadas')).toBeVisible();
  const grid = page.getByRole('list', { name: 'Productos' });
  await expect(grid.getByRole('listitem').filter({ hasText: 'Harina 000' })).toBeVisible();
  await expect(grid.getByRole('listitem').filter({ hasText: 'Agua mineral' })).toHaveCount(0);

  // Producción no cambia: sigue sin familias propias elegidas.
  await go(page, '/produccion');
  await expect(page.getByRole('heading', { name: 'Producción', level: 1 })).toBeVisible();
  await expect(page.getByText('Todavía no hay familias de pastelería')).toHaveCount(0);
});

test('pastelera: entra directo a Pastelería y no ve Producción', async ({ page, isMobile }) => {
  await loadDemo(page);
  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Pastelera');
  await d.getByLabel(/^PIN( ·|$)/).fill('1357');
  await d.getByLabel('Repetí el PIN').fill('1357');
  await d.getByLabel('Rol').selectOption('pastry');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Pastelera', { exact: true })).toBeVisible();

  if (isMobile) {
    await go(page, '/mas');
    await page.getByRole('button', { name: 'Bloquear / cambiar usuario' }).click();
  } else {
    await page.getByRole('button', { name: /^Usuario:/ }).click();
    await page.getByRole('menuitem', { name: 'Bloquear / cambiar usuario' }).click();
  }
  await login(page, 'Pastelera', '1357');
  await expect(page.getByRole('heading', { name: 'Pastelería', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/pasteleria$/);
  const nav = page.getByRole('navigation', { name: isMobile ? 'Navegación inferior' : 'Navegación principal' });
  await expect(nav.getByRole('link', { name: 'Producción' })).toHaveCount(0);
  // Un enlace a Producción la devuelve a Pastelería.
  await page.evaluate(() => { location.hash = '#/produccion'; });
  await expect(page).toHaveURL(/#\/pasteleria$/);
  await expect(page.getByRole('heading', { name: 'Pastelería', level: 1 })).toBeVisible();
  // El asistente sí lo puede abrir (para pasar recetas de una foto).
  await page.evaluate(() => { location.hash = '#/asistente'; });
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/#\/asistente$/);
  await page.reload();
  await expect(page).toHaveURL(/#\/asistente$/);
});

test('pastelería: crear un producto nuevo y su receta (con un insumo nuevo) sin entrar a Productos', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/pasteleria');
  await page.getByRole('button', { name: 'Nuevo producto' }).first().click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Torta rogel');
  await d.getByRole('button', { name: 'Crear y cargar receta' }).click();
  await expect(page.getByText('Creado “Torta rogel”')).toBeVisible();
  const r = page.getByRole('dialog', { name: 'Receta: Torta rogel' });
  await r.getByLabel('Agregar insumo').fill('Harina 000');
  await r.getByLabel('Cantidad de Harina 000').fill('0,5');
  await r.getByLabel('Agregar insumo').fill('Dulce de leche repostero');
  await r.getByLabel('Unidad del insumo nuevo').selectOption({ label: 'kg' });
  await r.getByRole('button', { name: 'Crear insumo' }).click();
  await r.getByLabel('Cantidad de Dulce de leche repostero').fill('1');
  await r.getByRole('button', { name: 'Guardar receta' }).click();
  await expect(page.getByText('Receta guardada')).toBeVisible();
  // Queda en Pastelería (familia creada sola) con su receta.
  const grid = page.getByRole('list', { name: 'Productos' });
  await grid.getByRole('listitem').filter({ hasText: 'Torta rogel' }).click();
  await expect(dialog(page)).toContainText('Harina 000');
  await expect(dialog(page)).toContainText('Dulce de leche repostero');
});

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

  // Entra directo a Producción; la navegación sólo ofrece Producción.
  await expect(page.getByRole('heading', { name: 'Producción', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/produccion$/);
  const nav = page.getByRole('navigation', { name: isMobile ? 'Navegación inferior' : 'Navegación principal' });
  await expect(nav.getByRole('link', { name: 'Producción' })).toBeVisible();
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
  await expect(page.getByText('Receta guardada')).toBeVisible();
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
  await expect(page.getByText('Receta guardada')).toBeVisible();

  // Quitar receta pide confirmación
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Recetas' }).click();
  await page.getByRole('button', { name: /Tomate/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Quitar receta' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Quitar receta' }).click();
  await expect(page.getByText('Receta quitada')).toBeVisible();
  await expect(page.getByRole('button', { name: /Tomate.*Sin receta/ })).toBeVisible();
});

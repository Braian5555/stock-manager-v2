import { expect, test } from '@playwright/test';
import { ADMIN, dialog, go, loadDemo } from './helpers';

test('configuración: eliminar todos los datos pide el PIN y deja el negocio en cero', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/configuracion/aplicacion');
  await page.getByRole('button', { name: 'Eliminar todos los datos' }).click();
  const d = dialog(page);
  await expect(d.getByText('No se puede deshacer.')).toBeVisible();
  await expect(d.getByText('Productos')).toBeVisible();

  // PIN incorrecto: no borra nada.
  await d.getByLabel(/^PIN de/).fill('9999');
  await d.getByRole('button', { name: 'Eliminar todo' }).click();
  await expect(d.getByText('PIN incorrecto.')).toBeVisible();

  await d.getByLabel(/^PIN de/).fill(ADMIN.pin);
  await d.getByRole('button', { name: 'Eliminar todo' }).click();
  await expect(page.getByText('Datos eliminados.')).toBeVisible();

  const counts = await page.evaluate(async () => {
    const open = indexedDB.open('stock-manager');
    const dbi: IDBDatabase = await new Promise((r) => { open.onsuccess = () => r(open.result); });
    const count = (t: string) => new Promise<number>((r) => { const q = dbi.transaction(t).objectStore(t).count(); q.onsuccess = () => r(q.result); });
    return { products: await count('products'), movements: await count('movements'), suppliers: await count('suppliers'), users: await count('users'), units: await count('units') };
  });
  expect(counts).toEqual({ products: 0, movements: 0, suppliers: 0, users: 1, units: 10 });

  // La app sigue funcionando y ofrece empezar de nuevo.
  await go(page, '/stock');
  await expect(page.getByRole('link', { name: 'Crear producto' })).toBeVisible();
});

test('configuración: empezar de cero deja el stock en 0 y conserva productos y recetas', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/configuracion/aplicacion');
  await page.getByRole('button', { name: 'Empezar de cero' }).click();
  const d = dialog(page);
  await expect(d.getByText('Movimientos')).toBeVisible();
  await d.getByLabel(/^PIN de/).fill(ADMIN.pin);
  const download = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Poner todo en 0' }).click();
  expect((await download).suggestedFilename()).toMatch(/^backup_antes-de-empezar-de-cero_/);
  await expect(page.getByText(/^Listo: \d+ productos en 0/)).toBeVisible();

  const r = await page.evaluate(async () => {
    const open = indexedDB.open('stock-manager');
    const dbi: IDBDatabase = await new Promise((res) => { open.onsuccess = () => res(open.result); });
    const all = <T,>(t: string) => new Promise<T[]>((res) => { const q = dbi.transaction(t).objectStore(t).getAll(); q.onsuccess = () => res(q.result as T[]); });
    const products = await all<{ stock: number }>('products');
    return { products: products.length, withStock: products.filter((p) => p.stock !== 0).length, movements: (await all('movements')).length };
  });
  expect(r.products).toBeGreaterThan(0);
  expect(r).toMatchObject({ withStock: 0, movements: 0 });
});

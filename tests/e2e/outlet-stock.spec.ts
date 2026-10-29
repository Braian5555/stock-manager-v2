import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('Stock: elegir un punto muestra lo que recibió, separado por familia', async ({ page }) => {
  await loadDemo(page);
  // Un punto con mercadería recibida (como la deja un remito hecho con el asistente).
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const q = indexedDB.open('stock-manager'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const all = <T,>(t: string) => new Promise<T[]>((res) => { const q = db.transaction(t).objectStore(t).getAll(); q.onsuccess = () => res(q.result as T[]); });
    const products = await all<{ id: string; name: string }>('products');
    const agua = products.find((p) => p.name === 'Agua mineral 500 ml')!;
    const t = new Date().toISOString();
    const tx = db.transaction(['outlets', 'movements'], 'readwrite');
    tx.objectStore('outlets').put({ id: 'confi', name: 'Confitería', active: true, createdAt: t, updatedAt: t });
    tx.objectStore('movements').put({ id: 'm-confi-1', createdAt: t, updatedAt: t, productId: agua.id, productName: agua.name, type: 'ingreso', quantityBefore: 0, quantityAfter: 6, delta: 6, origin: 'remito', sourceSystem: 'local', idempotencyKey: 'test:confi:1', absolute: false, outletId: 'confi' });
    await new Promise((r) => { tx.oncomplete = r; });
  });
  await page.reload();
  await go(page, '/stock');
  await page.getByRole('button', { name: 'Confitería' }).click();
  await expect(page.getByText('Stock en Confitería según los remitos recibidos')).toBeVisible();
  await expect(page.locator('.list-group-title', { hasText: 'Bebidas' })).toBeVisible();
  await expect(page.locator('.list-item', { hasText: 'Agua mineral 500 ml' })).toContainText('6');
  // Todas las bebidas aparecen para contarlas, aunque el punto nunca las haya recibido.
  await expect(page.getByText('Familias que se cuentan acá: Bebidas')).toBeVisible();
  await expect(page.locator('.list-item', { hasText: 'Gaseosa cola 1,5 L' })).toContainText('0');
  // Sin mínimos no avisa; con mínimo cargado avisa lo que falta, también en el botón del punto.
  await expect(page.getByText('Para que avise lo que falta en Confitería')).toBeVisible();
  await page.getByRole('button', { name: 'Mínimos' }).click();
  const min = page.getByLabel('Mínimo de Agua mineral 500 ml en Confitería');
  await min.fill('10');
  await min.press('Enter');
  await page.getByRole('button', { name: 'Listo con los mínimos' }).click();
  await expect(page.getByText('Falta 1 producto en Confitería')).toBeVisible();
  await expect(page.locator('.list-item', { hasText: 'Agua mineral 500 ml' })).toContainText('Bajo');
  await expect(page.locator('.list-item', { hasText: 'Agua mineral 500 ml' })).toContainText('faltan 4');
  await expect(page.getByRole('button', { name: 'Confitería · faltan 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver solo lo que falta' }).click();
  await expect(page.locator('.list-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ver todo' }).click();
  // Se puede elegir otra familia para el punto.
  await page.getByRole('button', { name: 'Familias del punto' }).click();
  await dialog(page).getByLabel('Hielo').check();
  await dialog(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Familias que se cuentan acá: Bebidas, Hielo')).toBeVisible();
  await expect(page.locator('.list-group-title', { hasText: 'Hielo' })).toBeVisible();
  await page.getByRole('button', { name: 'Contar este punto' }).click();
  await expect(page).toHaveURL(/#\/conteo\//);
  const countUrl = page.url();
  await expect(page.getByText('Gaseosa cola 1,5 L').first()).toBeVisible();
  // Volver a tocar no arma otro conteo: sigue el que está abierto.
  await go(page, '/stock');
  await page.getByRole('button', { name: /^Confitería/ }).click();
  await page.getByRole('button', { name: 'Seguir el conteo abierto' }).click();
  await expect(page).toHaveURL(countUrl);
  await go(page, '/stock');
  await page.getByRole('button', { name: 'Depósito Central' }).click();
  await expect(page.getByRole('article', { name: 'Agua mineral 500 ml' })).toBeVisible();
});

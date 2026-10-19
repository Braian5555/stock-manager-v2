import { expect, test } from '@playwright/test';
import { go, loadDemo } from './helpers';

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
  await page.getByRole('button', { name: 'Depósito Central' }).click();
  await expect(page.getByRole('article', { name: 'Agua mineral 500 ml' })).toBeVisible();
});

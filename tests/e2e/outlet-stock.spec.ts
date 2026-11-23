import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo, login } from './helpers';

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
  await expect(page.getByText('Stock en Confitería', { exact: true })).toBeVisible();
  await expect(page.locator('.group-chip', { hasText: 'Bebidas' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Agua mineral 500 ml' })).toContainText('6');
  // Todas las bebidas aparecen para contarlas, aunque el punto nunca las haya recibido.
  await expect(page.getByText('Familias que se cuentan acá: Bebidas')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Gaseosa cola 1,5 L' })).toContainText('0');
  // Sin mínimos no avisa; con mínimo cargado avisa lo que falta, también en el botón del punto.
  await expect(page.getByText('Para que avise lo que falta en Confitería')).toBeVisible();
  await page.getByRole('button', { name: 'Mínimos' }).click();
  const min = page.getByLabel('Mínimo de Agua mineral 500 ml en Confitería');
  await min.fill('10');
  await min.press('Enter');
  await page.getByRole('button', { name: 'Listo con los mínimos' }).click();
  await expect(page.getByText('Falta 1 producto en Confitería')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Agua mineral 500 ml' })).toContainText('Stock bajo');
  await expect(page.getByRole('article', { name: 'Agua mineral 500 ml' })).toContainText('faltan 4');
  await expect(page.getByRole('button', { name: 'Confitería · faltan 1' })).toBeVisible();
  await page.screenshot({ path: 'test-results/punto-tarjetas.png', fullPage: true });
  await page.getByRole('button', { name: 'Ver solo lo que falta' }).click();
  await expect(page.locator('article.pcard')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ver todo' }).click();
  // Se puede elegir otra familia para el punto.
  await page.getByRole('button', { name: 'Familias del punto' }).click();
  await dialog(page).getByLabel('Hielo').check();
  await dialog(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Familias que se cuentan acá: Bebidas, Hielo')).toBeVisible();
  await expect(page.locator('.group-chip', { hasText: 'Hielo' })).toBeVisible();
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

async function confiWithWater(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const q = indexedDB.open('stock-manager'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const all = <T,>(t: string) => new Promise<T[]>((res) => { const q = db.transaction(t).objectStore(t).getAll(); q.onsuccess = () => res(q.result as T[]); });
    const agua = (await all<{ id: string; name: string }>('products')).find((p) => p.name === 'Agua mineral 500 ml')!;
    const t = new Date().toISOString();
    const tx = db.transaction(['outlets', 'movements'], 'readwrite');
    tx.objectStore('outlets').put({ id: 'confi', name: 'Confitería', active: true, createdAt: t, updatedAt: t });
    tx.objectStore('outlets').put({ id: 'chiri', name: 'Chiringuito', active: true, createdAt: t, updatedAt: t });
    tx.objectStore('movements').put({ id: 'm-confi-1', createdAt: t, updatedAt: t, productId: agua.id, productName: agua.name, type: 'ingreso', quantityBefore: 0, quantityAfter: 6, delta: 6, origin: 'remito', sourceSystem: 'local', idempotencyKey: 'test:confi:1', absolute: false, outletId: 'confi' });
    await new Promise((r) => { tx.oncomplete = r; });
  });
  await page.reload();
}

test('en un punto se registran movimientos con su propio stock (sin tocar el Depósito Central)', async ({ page }) => {
  await loadDemo(page);
  await confiWithWater(page);
  await go(page, '/stock');
  await page.getByRole('button', { name: 'Confitería' }).click();
  await page.getByRole('button', { name: 'Registrar movimiento de Agua mineral 500 ml en Confitería' }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Movimiento en Confitería · Agua mineral 500 ml' })).toBeVisible();
  await expect(d.getByLabel('Tipo de movimiento')).toHaveValue('consumo');
  await d.getByLabel(/^Cantidad/).fill('4');
  await expect(d.getByText(/Stock en Confitería\s*6\s*→ nuevo\s*2/)).toBeVisible();
  await d.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByRole('article', { name: 'Agua mineral 500 ml' })).toContainText('2');
  // Sacar más de lo que hay deja el punto en 0.
  await page.getByRole('button', { name: 'Registrar movimiento de Agua mineral 500 ml en Confitería' }).click();
  await d.getByLabel(/^Cantidad/).fill('5');
  await expect(d.getByText(/No alcanza: hay 2 .* en Confitería/)).toBeVisible();
  await d.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByRole('article', { name: 'Agua mineral 500 ml' }).locator('.pcard-qty strong')).toHaveText(/^0/);
  // El Depósito Central no cambió.
  await page.getByRole('button', { name: 'Depósito Central' }).click();
  await expect(page.getByRole('article', { name: 'Agua mineral 500 ml' })).toContainText('48');
});

test('quien trabaja en un punto ve sólo el stock de ese punto', async ({ page, isMobile }) => {
  await loadDemo(page);
  await confiWithWater(page);
  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Moza Confi');
  await d.getByLabel(/^PIN( ·|$)/).fill('4321');
  await d.getByLabel('Repetí el PIN').fill('4321');
  await expect(d.getByText(/(Puntos|Locales) donde trabaja/)).toBeVisible();
  await d.getByLabel('Confitería').check();
  await d.getByRole('button', { name: 'Guardar' }).click();
  if (isMobile) {
    await go(page, '/mas');
    await page.getByRole('button', { name: 'Bloquear / cambiar usuario' }).click();
  } else {
    await page.getByRole('button', { name: /^Usuario:/ }).click();
    await page.getByRole('menuitem', { name: 'Bloquear / cambiar usuario' }).click();
  }
  await login(page, 'Moza Confi', '4321');
  await go(page, '/stock');
  await expect(page.getByText('Stock en Confitería', { exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Agua mineral 500 ml' })).toContainText('6');
  await expect(page.getByRole('button', { name: 'Depósito Central' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Chiringuito' })).toHaveCount(0);
  // Aunque venga un enlace al Depósito o a otro punto, se queda en el suyo.
  await go(page, '/stock?punto=chiri');
  await expect(page.getByText('Stock en Confitería', { exact: true })).toBeVisible();
});

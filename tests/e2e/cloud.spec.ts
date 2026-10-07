import { expect, test, type Page } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

/**
 * Flujo de la nube con el backend EN MEMORIA ("fake"): valida la interfaz y la
 * sincronización sin depender de una cuenta real de Google/Firebase.
 */
async function useFakeCloud(page: Page) {
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
}

type FakeStore = {
  workspaces: Map<string, { id: string }>;
  coll: (p: string) => Map<string, Record<string, unknown>>;
  write: (p: string, d: Record<string, unknown>) => Promise<void>;
  setOnline: (v: boolean) => void;
};

test('nube: iniciar sesión, crear espacio, subir datos y recibir cambios de otro dispositivo', async ({ page }) => {
  await useFakeCloud(page);
  await loadDemo(page);
  await go(page, '/nube');
  await page.getByRole('button', { name: 'Iniciar sesión con Google' }).click();
  await expect(page.getByText('demo@ejemplo.com')).toBeVisible();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  const remoteCount = await page.evaluate(() => {
    const s = (globalThis as unknown as { __smFakeCloud: FakeStore }).__smFakeCloud;
    const wsId = [...s.workspaces.keys()][0];
    return s.coll(`${wsId}/products`).size;
  });
  expect(remoteCount).toBe(15);

  // "Otro dispositivo" crea un producto → aparece acá sin recargar.
  await page.evaluate(async () => {
    const s = (globalThis as unknown as { __smFakeCloud: FakeStore }).__smFakeCloud;
    const wsId = [...s.workspaces.keys()][0];
    const t = new Date().toISOString();
    await s.write(`${wsId}/products`, { id: 'p-remoto', name: 'Producto cargado en el celular', purchaseFactor: 1, alternativeSupplierIds: [], stock: 0, minStock: 0, maxStock: 0, active: true, createdAt: t, updatedAt: t });
  });
  await go(page, '/productos');
  await expect(page.locator('td.cell-title', { hasText: 'Producto cargado en el celular' })).toBeVisible();

  // Sin conexión con la nube: el cambio queda pendiente y se envía al volver.
  await page.evaluate(() => (globalThis as unknown as { __smFakeCloud: FakeStore }).__smFakeCloud.setOnline(false));
  await page.getByRole('button', { name: 'Eliminar Sal fina' }).click();
  await dialog(page).getByRole('button', { name: 'Eliminar' }).click();
  await go(page, '/nube');
  await expect(page.getByText(/Enviando cambios|Cambios por enviar/).first()).toBeVisible();
  await page.evaluate(() => (globalThis as unknown as { __smFakeCloud: FakeStore }).__smFakeCloud.setOnline(true));
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  // Invitar a un empleado
  await page.getByLabel('Invitar por email (cuenta de Google)').fill('empleado@gmail.com');
  await page.getByRole('button', { name: 'Invitar' }).click();
  await expect(page.getByText('empleado@gmail.com').first()).toBeVisible();

  // Desvincular no borra datos
  await page.getByRole('button', { name: 'Desvincular este dispositivo' }).click();
  await dialog(page).getByRole('button', { name: 'Desvincular' }).click();
  await go(page, '/productos');
  await expect(page.locator('td.cell-title', { hasText: 'Producto cargado en el celular' })).toBeVisible();
});

test('nube sin configurar: la app sigue funcionando y explica cómo activarla', async ({ page }) => {
  await go(page, '/nube');
  await expect(page.getByText('La nube todavía no está configurada')).toBeVisible();
});

test('con configuración de Firebase carga el SDK real y ofrece iniciar sesión (sin romper la app)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/firebase-config.json', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ apiKey: 'AIzaSy-prueba-no-real', authDomain: 'demo-stock.firebaseapp.com', projectId: 'demo-stock', appId: '1:123:web:abc' }) }),
  );
  await go(page, '/nube');
  await expect(page.getByRole('button', { name: 'Iniciar sesión con Google' })).toBeVisible({ timeout: 15000 });
  await go(page, '/stock');
  expect(errors).toEqual([]);
});

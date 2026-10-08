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
  await page.getByRole('button', { name: 'Entrar con una cuenta de Google' }).click();
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
  await page.getByLabel('Invitar por email').fill('empleado@gmail.com');
  await page.getByRole('button', { name: 'Invitar' }).click();
  await expect(page.getByText('empleado@gmail.com').first()).toBeVisible();

  // Desvincular no borra datos
  await page.getByRole('button', { name: 'Desvincular este dispositivo' }).click();
  await dialog(page).getByRole('button', { name: 'Desvincular' }).click();
  await go(page, '/productos');
  await expect(page.locator('td.cell-title', { hasText: 'Producto cargado en el celular' })).toBeVisible();
});

test('nube sin configurar: la app sigue funcionando y explica cómo activarla', async ({ page }) => {
  await page.route('**/firebase-config.json', (r) => r.fulfill({ status: 404, body: '' }));
  await go(page, '/nube');
  await expect(page.getByText('La nube todavía no está configurada')).toBeVisible();
});

test('con configuración de Firebase carga el SDK real y ofrece iniciar sesión (sin romper la app)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/firebase-config.json', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ apiKey: 'AIzaSy-prueba-no-real', authDomain: 'demo-stock.firebaseapp.com', projectId: 'demo-stock', appId: '1:123:web:abc' }) }),
  );
  await page.goto('./');
  // Dispositivo nuevo con la nube configurada: lo primero es iniciar sesión.
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await go(page, '/stock');
  expect(errors).toEqual([]);
});

test('cuenta con email y contraseña: los datos vuelven al entrar desde un navegador vacío', async ({ browser }) => {
  // Dispositivo 1: crea la cuenta, el espacio y carga un producto.
  const ctx1 = await browser.newContext();
  const page = await ctx1.newPage();
  await useFakeCloud(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await page.getByRole('button', { name: 'Crear una cuenta' }).click();
  await page.getByLabel('Tu nombre').fill('Nicolás');
  await page.getByLabel('Email').fill('nico@ejemplo.com');
  await page.getByLabel(/^Contraseña/).fill('secreta123');
  await page.getByLabel('Repetí la contraseña').fill('secreta123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.locator('main#contenido')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usuario: Nicolás' })).toBeVisible();
  await page.getByRole('button', { name: 'Cargar datos de ejemplo' }).click();
  await expect(page.getByText('Datos de ejemplo cargados')).toBeVisible();

  // Simula otro navegador/dispositivo (almacenamiento vacío) con la misma "nube".
  const snapshot = await page.evaluate(() => {
    const s = (globalThis as unknown as { __smFakeCloud: { workspaces: Map<string, unknown>; data: Map<string, Map<string, unknown>>; accounts: Map<string, unknown> } }).__smFakeCloud;
    return JSON.stringify({ ws: [...s.workspaces], data: [...s.data].map(([k, v]) => [k, [...v]]), acc: [...s.accounts] });
  });
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await useFakeCloud(page2);
  await page2.addInitScript((snap) => {
    const o = JSON.parse(snap);
    const g = globalThis as unknown as { __smSeed?: unknown };
    g.__smSeed = o;
  }, snapshot);
  await page2.goto('./');
  await page2.evaluate(async () => {
    const g = globalThis as unknown as { __smSeed: { ws: [string, unknown][]; data: [string, [string, unknown][]][]; acc: [string, unknown][] }; __smFakeCloud?: { workspaces: Map<string, unknown>; data: Map<string, Map<string, unknown>>; accounts: Map<string, unknown> } };
    for (let i = 0; i < 50 && !g.__smFakeCloud; i++) await new Promise((r) => setTimeout(r, 50));
    const s = g.__smFakeCloud!;
    for (const [k, v] of g.__smSeed.ws) s.workspaces.set(k, v);
    for (const [k, v] of g.__smSeed.data) s.data.set(k, new Map(v));
    for (const [k, v] of g.__smSeed.acc) s.accounts.set(k, v);
  });
  await expect(page2.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await page2.getByLabel('Email').fill('nico@ejemplo.com');
  await page2.getByLabel(/^Contraseña/).fill('mal');
  await page2.getByRole('button', { name: 'Entrar' }).click();
  await expect(page2.getByText('Email o contraseña incorrectos.')).toBeVisible();
  await page2.getByLabel(/^Contraseña/).fill('secreta123');
  await page2.getByRole('button', { name: 'Entrar' }).click();
  // Un solo espacio: se abre solo, baja los datos y entra como el mismo usuario.
  await expect(page2.getByRole('button', { name: 'Usuario: Nicolás' })).toBeVisible();
  await go(page2, '/productos');
  await expect(page2.locator('td.cell-title', { hasText: 'Sal fina' })).toBeVisible();
  await go(page2, '/usuarios');
  await expect(page2.getByText('nico@ejemplo.com')).toBeVisible();
  await expect(page2.locator('.list-title', { hasText: 'Nicolás' })).toHaveCount(1);
  await ctx1.close();
  await ctx2.close();
});

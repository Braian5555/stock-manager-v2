import { expect, test, type Page } from '@playwright/test';
import { dialog, go, loadDemo, login, open } from './helpers';

/**
 * Un día real de trabajo, de punta a punta: nube, receta, el panadero anota, el Inicio y la
 * vitrina lo reflejan, se vende, se trabaja sin conexión y se sincroniza, el diagnóstico queda
 * limpio y todo sobrevive a recargar. Además: cada rol en cada pantalla, sin errores ni
 * desbordes en el celular, y la app vacía (primer uso).
 */

type FakeStore = {
  workspaces: Map<string, { id: string }>;
  coll: (p: string) => Map<string, Record<string, unknown>>;
  setOnline: (v: boolean) => void;
};

const stockOf = (page: Page, name: string) => page.evaluate(async (n) => {
  const req = indexedDB.open('stock-manager');
  const dbi: IDBDatabase = await new Promise((r) => { req.onsuccess = () => r(req.result); });
  const all: { name: string; stock: number }[] = await new Promise((r) => { const q = dbi.transaction('products').objectStore('products').getAll(); q.onsuccess = () => r(q.result); });
  return all.find((p) => p.name === n)!.stock;
}, name);

const countLocal = (page: Page, table: string) => page.evaluate(async (t) => {
  const req = indexedDB.open('stock-manager');
  const dbi: IDBDatabase = await new Promise((r) => { req.onsuccess = () => r(req.result); });
  return new Promise<number>((r) => { const q = dbi.transaction(t).objectStore(t).count(); q.onsuccess = () => r(q.result); });
}, table);

const remoteCount = (page: Page, table: string) => page.evaluate((t) => {
  const s = (globalThis as unknown as { __smFakeCloud: FakeStore }).__smFakeCloud;
  return s.coll(`${[...s.workspaces.keys()][0]}/${t}`).size;
}, table);

async function lockScreen(page: Page, isMobile: boolean) {
  if (isMobile) {
    await go(page, '/mas');
    await page.getByRole('button', { name: /Bloquear \/ cambiar usuario|Cerrar sesión/ }).click();
  } else {
    await page.getByRole('button', { name: /^Usuario:/ }).click();
    await page.getByRole('menuitem', { name: 'Bloquear / cambiar usuario' }).click();
  }
}

async function createUser(page: Page, name: string, pin: string, role: string) {
  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill(name);
  await d.getByLabel(/^PIN( ·|$)/).fill(pin);
  await d.getByLabel('Repetí el PIN').fill(pin);
  await d.getByLabel('Rol').selectOption(role);
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

test('día de trabajo completo: receta, panadero, Inicio, vitrina, sin conexión y diagnóstico', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
  await loadDemo(page);

  // 1. Receta: 2 "Sal fina" llevan 1 kg de Harina 000.
  await go(page, '/productos');
  await page.getByRole('button', { name: 'Editar Sal fina' }).click();
  const f = dialog(page);
  await f.getByLabel('Agregar insumo').fill('Harina 000');
  await f.getByLabel('Rinde').fill('2');
  await f.getByLabel('Cantidad de Harina 000').fill('1');
  await f.getByRole('button', { name: 'Guardar' }).click();
  await expect(f).toBeHidden();
  const harina0 = await stockOf(page, 'Harina 000');
  const sal0 = await stockOf(page, 'Sal fina');

  // 2. El panadero entra con su PIN: sólo ve Producción y anota 4.
  await createUser(page, 'Panadero', '2468', 'production');
  await lockScreen(page, isMobile);
  await login(page, 'Panadero', '2468');
  await expect(page).toHaveURL(/#\/produccion$/);
  await page.getByLabel('Buscar producto').fill('Sal fina');
  await page.getByRole('listitem').filter({ hasText: 'Sal fina' }).click();
  await dialog(page).getByLabel(/^Cantidad contada de/).fill('4');
  await dialog(page).getByRole('button', { name: /^Anotar 4/ }).click();
  await expect(page.getByText(/Anotado: 4 .* de Sal fina · se descontaron 1 insumo/)).toBeVisible();
  // No puede entrar a la vitrina ni a configuración.
  for (const hash of ['/vitrina', '/configuracion']) {
    await page.goto(`./#${hash}`);
    await expect(page.getByText('No tenés permiso para esta sección').or(page.getByRole('heading', { name: 'Producción', level: 1 }))).toBeVisible();
  }
  await expect.poll(() => stockOf(page, 'Harina 000')).toBe(harina0 - 2);
  await expect.poll(() => stockOf(page, 'Sal fina')).toBe(sal0 + 4);

  // 4. Vuelve el administrador (con su PIN) y conecta la nube: se sube todo, también lo del panadero.
  await go(page, '/produccion');
  await lockScreen(page, isMobile);
  await login(page, 'Admin Prueba', '1234');
  await go(page, '/nube');
  await page.getByRole('button', { name: 'Entrar con una cuenta de Google' }).click();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  await go(page, '/');
  const bakery = page.getByRole('region', { name: 'Panadería de hoy' });
  await expect(bakery).toContainText('Sal fina');
  await expect(bakery).toContainText('Panadero');
  const activity = page.getByRole('region', { name: 'Actividad reciente' });
  await expect(activity).toContainText('Producción');
  await expect(activity).toContainText('Consumo');

  // 5. Vitrina: se venden 3.
  await go(page, '/vitrina');
  const tile = page.getByRole('listitem').filter({ hasText: 'Sal fina' });
  await expect(tile).toContainText('Hoy +4');
  await tile.click();
  for (let i = 0; i < 3; i++) await dialog(page).getByRole('button', { name: '+1', exact: true }).click();
  await dialog(page).getByRole('button', { name: /^Descontar 3/ }).click();
  await expect(page.getByText(/^Vendido: 3 .* de Sal fina/)).toBeVisible();
  await expect.poll(() => stockOf(page, 'Sal fina')).toBe(sal0 + 1);

  // 6. Sin conexión con la nube: se sigue trabajando y al volver se envía todo.
  await page.evaluate(() => (globalThis as unknown as { __smFakeCloud: FakeStore }).__smFakeCloud.setOnline(false));
  await go(page, '/produccion');
  await page.getByLabel('Buscar producto').fill('Sal fina');
  await page.getByRole('listitem').filter({ hasText: 'Sal fina' }).click();
  await dialog(page).getByLabel(/^Cantidad contada de/).fill('2');
  await dialog(page).getByRole('button', { name: /^Anotar 2/ }).click();
  await expect(page.getByText(/Anotado: 2 .* de Sal fina/)).toBeVisible();
  await go(page, '/nube');
  await expect(page.getByText(/Enviando cambios|Cambios por enviar/).first()).toBeVisible();
  await page.evaluate(() => (globalThis as unknown as { __smFakeCloud: FakeStore }).__smFakeCloud.setOnline(true));
  await expect(page.getByText('Sincronizado').first()).toBeVisible();
  await expect.poll(async () => (await remoteCount(page, 'movements')) - (await countLocal(page, 'movements')), { timeout: 15_000 }).toBe(0);
  await expect.poll(() => remoteCount(page, 'users')).toBe(await countLocal(page, 'users'));

  // 7. Diagnóstico: el stock coincide con los movimientos y no hubo errores.
  await go(page, '/diagnostico');
  await expect(page.getByText('El stock de todos los productos coincide con su historial.', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Sincronizado con/).first()).toBeVisible();

  // 8. Volver al Inicio: todo reflejado. (Recargar con la nube simulada pierde la sesión de prueba;
  // que los datos sobreviven al cierre lo cubren persistence.spec y cloud.spec.)
  await go(page, '/');
  await expect(page.getByRole('region', { name: 'Panadería de hoy' })).toContainText('Sal fina');
  expect(await stockOf(page, 'Sal fina')).toBe(sal0 + 3);
  expect(errors).toEqual([]);
});

const ALL_ROUTES = [
  '/', '/stock', '/movimientos', '/conteo', '/produccion', '/pasteleria', '/asistente', '/vitrina', '/productos', '/familias', '/unidades', '/ubicaciones',
  '/facturas', '/configuracion', '/usuarios', '/nube', '/exportar', '/integraciones', '/diagnostico', '/ayuda', '/acerca', '/mas',
];

test('cada rol en cada pantalla: sin errores, con permisos y sin desbordes en el celular', async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${page.url()} → ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(`${page.url()} → consola: ${m.text().slice(0, 200)}`); });
  await loadDemo(page);
  await createUser(page, 'Encargada', '1111', 'manager');
  await createUser(page, 'Cajero', '2222', 'staff');
  await createUser(page, 'Horno', '3333', 'production');
  await createUser(page, 'Tortas', '4444', 'pastry');

  const overflow: string[] = [];
  for (const [name, pin] of [['Admin Prueba', '1234'], ['Encargada', '1111'], ['Cajero', '2222'], ['Horno', '3333'], ['Tortas', '4444']]) {
    if (name !== 'Admin Prueba') {
      await lockScreen(page, isMobile);
      await login(page, name, pin);
    }
    for (const hash of ALL_ROUTES) {
      await page.goto(`./#${hash}`);
      // Cada pantalla abre con su título, o avisa que no hay permiso (nunca queda en blanco).
      await expect(page.locator('main h1').first().or(page.getByText('No tenés permiso para esta sección')).first(), `${name} ${hash}`).toBeVisible();
      if (isMobile) {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (wide > 1) overflow.push(`${name} ${hash}: ${wide}px`);
      }
    }
    if (name !== 'Horno' && name !== 'Tortas') {
      // El Inicio respeta los permisos de cada rol.
      await go(page, '/');
      const actions = page.getByRole('navigation', { name: 'Acciones rápidas' });
      await expect(actions).toBeVisible();
      await expect(actions.getByRole('link', { name: /^Vitrina/ })).toHaveCount(name === 'Cajero' ? 0 : 1);
      await expect(page.getByRole('region', { name: 'Facturas de la semana' })).toHaveCount(1);
    }
  }
  expect(overflow).toEqual([]);
  expect(errors).toEqual([]);
});

test('primer uso con la app vacía: todas las pantallas abren y el Inicio ofrece empezar', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByRole('button', { name: 'Cargar datos de ejemplo' })).toBeVisible();
  for (const hash of ALL_ROUTES) {
    await page.goto(`./#${hash}`);
    await expect(page.locator('main h1').first(), hash).toBeVisible();
  }
  await go(page, '/');
  await expect(page.getByRole('region', { name: 'Panadería de hoy' })).toContainText('Todavía no hay plan');
  await expect(page.getByRole('region', { name: 'Para reponer' })).toContainText('Nada por debajo del mínimo');
  expect(errors.filter((e) => !/favicon|manifest/i.test(e))).toEqual([]);
});

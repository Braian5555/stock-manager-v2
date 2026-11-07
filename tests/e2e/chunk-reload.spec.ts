import { expect, test } from '@playwright/test';
import { go, open } from './helpers';

test('si la app se actualizó mientras estaba abierta, Configuración igual entra (recarga sola una vez)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Configuración está en la barra de arriba de la computadora');
  await open(page);
  await go(page, '/stock');
  // Simula que el archivo de la pantalla ya no existe en el servidor (nombre de una versión anterior).
  let blocked = 0;
  await page.route(/SettingsPage-[^/]+\.js$/, (r) => {
    if (blocked++ === 0) return r.fulfill({ status: 404, body: 'not found' });
    return r.continue();
  });
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Configuración' }).click();
  await page.getByRole('navigation', { name: 'Menú: Administración' }).getByRole('link', { name: 'Configuración general' }).click();
  await expect(page.locator('main h1').first()).toHaveText('Configuración', { timeout: 15000 });
  expect(blocked).toBeGreaterThanOrEqual(2); // falló una vez, recargó y la segunda vez entró
});

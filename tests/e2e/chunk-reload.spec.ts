import { expect, test } from '@playwright/test';
import { open } from './helpers';

test('si la app se actualizó mientras estaba abierta, Configuración igual entra (recarga sola una vez)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'el engranaje está en la barra de la computadora');
  await open(page);
  // Simula que el archivo de la pantalla ya no existe en el servidor (nombre de una versión anterior).
  let blocked = 0;
  await page.route(/SettingsPage-[^/]+\.js$/, (r) => {
    if (blocked++ === 0) return r.fulfill({ status: 404, body: 'not found' });
    return r.continue();
  });
  await page.locator('.topbar-settings').click();
  await expect(page.locator('main h1').first()).toHaveText('Configuración', { timeout: 15000 });
  expect(blocked).toBeGreaterThanOrEqual(2); // falló una vez, recargó y la segunda vez entró
});

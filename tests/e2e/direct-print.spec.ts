import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { go, loadDemo } from './helpers';

test('impresión directa: descarga el instalador que crea el acceso de la caja (logo + --kiosk-printing)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'es para la compu de la caja');
  await loadDemo(page);
  await go(page, '/salon/configuracion/impresion');
  await expect(page.getByRole('heading', { name: 'Imprimir directo, sin el cuadro de impresión' })).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar instalador del acceso (Windows)' }).click()]);
  expect(file.suggestedFilename()).toBe('Crear acceso Orillas Caja.bat');
  const bat = readFileSync((await file.path())!, 'utf8');
  expect(bat).toContain('\r\n');
  const encoded = /-EncodedCommand (\S+)/.exec(bat)![1];
  const ps = Buffer.from(encoded, 'base64').toString('utf16le');
  expect(ps).toContain('--kiosk-printing');
  expect(ps).toMatch(/\$url = 'http:\/\/[^']+\/#\/salon'/);
  expect(ps).toMatch(/brand\/orillas\.ico/);
  expect(ps).toContain('App Paths\\chrome.exe');
  expect(ps).toContain("'Orillas Caja (impresion directa).lnk'");
  // El ícono existe en la app publicada.
  const ico = await page.request.get('./brand/orillas.ico');
  expect(ico.ok()).toBe(true);
});

test('certificado de ARCA: genera la clave y el pedido (CSR) en el navegador y los descarga', async ({ page, isMobile }) => {
  test.skip(isMobile, 'se hace en la compu');
  await loadDemo(page);
  await go(page, '/salon/configuracion/facturacion');
  await page.getByLabel('CUIT', { exact: true }).fill('30-71234567-1');
  await page.getByLabel('Razón social').fill('Epicurae SA');
  await page.getByLabel('Alias (nombre del equipo en ARCA)').fill('Orillas Caja');
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.getByRole('button', { name: 'Generar clave y pedido' }).click();
  await expect(page.getByLabel('Pedido (CSR) para pegar en ARCA')).toHaveValue(/^-----BEGIN CERTIFICATE REQUEST-----/);
  expect(downloads).toEqual([]); // una descarga por botón: Chrome no las bloquea como "múltiples"
  await page.getByRole('button', { name: 'Guardar la clave (.key)' }).click();
  await page.getByRole('button', { name: 'Guardar el pedido (.csr)' }).click();
  await expect.poll(() => downloads.sort()).toEqual(['orillascaja-homologacion.csr', 'orillascaja-homologacion.key']);
});

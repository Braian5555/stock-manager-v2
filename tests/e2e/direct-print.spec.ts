import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { go, loadDemo } from './helpers';

test('impresión directa: descarga el acceso directo de la caja con --kiosk-printing', async ({ page, isMobile }) => {
  test.skip(isMobile, 'es para la compu de la caja');
  await loadDemo(page);
  await go(page, '/salon/configuracion/impresion');
  await expect(page.getByRole('heading', { name: 'Imprimir directo, sin el cuadro de impresión' })).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar acceso directo (Windows)' }).click()]);
  expect(file.suggestedFilename()).toBe('Orillas - Caja (impresion directa).bat');
  const bat = readFileSync((await file.path())!, 'utf8');
  expect(bat).toContain('--kiosk-printing');
  expect(bat).toContain('--user-data-dir="%PERFIL%"');
  expect(bat).toMatch(/set "URL=http:\/\/[^"]+\/"/);
  expect(bat).toContain('App Paths\\chrome.exe');
  expect(bat).toContain('\r\n');
  console.log(bat);
});

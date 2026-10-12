import { expect, test } from '@playwright/test';
import { go, loadDemo } from './helpers';

test('proveedores: planilla de compra imprimible y en Excel', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/proveedores');
  await page.evaluate(() => {
    window.print = () => {
      const w = window as unknown as { __sheets: { title: string; rows: number }[] };
      w.__sheets = [...document.querySelectorAll('.print-sheets .psheet')].map((s) => ({
        title: s.querySelector('h1')?.textContent ?? '',
        rows: s.querySelectorAll('tbody tr:not(.psheet-fam)').length,
      }));
    };
  });
  // Desde la fila de un proveedor: ya viene elegido
  await page.getByRole('button', { name: 'Planilla de compra de Distribuidora Ejemplo' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('checkbox', { name: 'Planilla de Distribuidora Ejemplo' })).toBeChecked();
  await expect(d.getByText(/1 hoja · \d+ productos/)).toBeVisible();
  await d.getByRole('button', { name: 'Imprimir planilla' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sheets?: { title: string; rows: number }[] }).__sheets)).toEqual([
    { title: 'Planilla de compra · Distribuidora Ejemplo', rows: 5 },
  ]);

  // Todos los proveedores: una hoja cada uno
  await d.getByRole('button', { name: 'Elegir todos' }).click();
  await expect(d.getByRole('button', { name: /Imprimir \d+ planillas/ })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), d.getByRole('button', { name: 'Excel' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^planillas-de-compra-.*\.xlsx$/);
});

import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('reportes: tocar Ingresos, Pérdidas o un producto muestra esos movimientos', async ({ page }) => {
  await loadDemo(page);
  // Registrar una pérdida para tener algo en ese grupo.
  await go(page, '/stock');
  await page.getByRole('searchbox').first().fill('Harina 000');
  await page.getByRole('article', { name: 'Harina 000' }).getByRole('button', { name: 'Registrar movimiento' }).click();
  const d = dialog(page);
  await d.getByLabel('Tipo de movimiento').selectOption({ label: 'Pérdida' });
  await d.getByLabel(/^Cantidad/).fill('2');
  await d.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText(/Pérdida registrado|Pérdida registrada/)).toBeVisible();

  await go(page, '/reportes');
  await page.getByRole('button', { name: '7 días' }).click();
  const ingresos = page.getByRole('link', { name: /^Ingresos registrados: (\d+)/ });
  const n = Number((await ingresos.getAttribute('aria-label'))!.match(/: (\d+)/)![1]);
  await ingresos.click();
  await expect(page).toHaveURL(/#\/movimientos\?.*tipo=grupo%3Aingresos/);
  await expect(page.getByRole('button', { name: 'Quitar filtro tipo' })).toContainText('Ingresos');
  await expect(page.locator('main h1 + p, .page-head p').first()).toContainText(`${n} movimientos`);

  await go(page, '/reportes');
  await page.getByRole('link', { name: /^Pérdidas: 1/ }).click();
  await expect(page.locator('.page-head p').first()).toContainText('1 movimientos');
  await expect(page.getByText('Harina 000').locator('visible=true').first()).toBeVisible();

  // Un producto de "Lo que más ingresó"
  await go(page, '/reportes');
  const first = page.getByRole('region', { name: 'Lo que más ingresó' }).getByRole('link').first();
  await first.click();
  await expect(page.getByRole('button', { name: 'Quitar filtro producto' })).toBeVisible();
  await page.getByRole('button', { name: 'Quitar filtro tipo' }).click();
  await expect(page.getByRole('button', { name: 'Quitar filtro tipo' })).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('vitrina: lo anotado en producción aparece con lo que queda y se descuenta hasta agotarse', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/produccion');
  await page.getByLabel('Buscar producto').fill('Harina');
  await page.getByRole('listitem').filter({ hasText: 'Harina 000' }).click();
  await dialog(page).getByRole('button', { name: '+5' }).click();
  await dialog(page).getByRole('button', { name: /^Anotar 5 kg/ }).click();
  await expect(page.getByText('Anotado: 5 kg de Harina 000')).toBeVisible();

  await go(page, '/vitrina');
  await expect(page.getByRole('heading', { name: 'Vitrina', level: 1 })).toBeVisible();
  const tile = page.getByRole('listitem').filter({ hasText: 'Harina 000' });
  await expect(tile).toContainText('Hoy +5');
  await tile.click();
  const m = dialog(page);
  const left = Number((await m.locator('p.muted b.num').first().innerText()).replace(/\./g, '').replace(',', '.'));
  expect(left).toBeGreaterThanOrEqual(5);
  await m.getByRole('button', { name: '+1', exact: true }).click();
  await m.getByRole('button', { name: '+1', exact: true }).click();
  await m.getByRole('button', { name: /^Descontar 2 kg/ }).click();
  await expect(page.getByText(`Vendido: 2 kg de Harina 000 · quedan ${String(left - 2).replace('.', ',')}`)).toBeVisible();
  await expect(tile).toContainText('salió 2');

  // Se terminó: pasa a "Agotado"
  await tile.click();
  await dialog(page).getByRole('button', { name: 'Se terminó' }).click();
  await expect(page.getByText(/Harina 000 · agotado/)).toBeVisible();
  await page.getByRole('group', { name: 'Mostrar' }).getByRole('button', { name: /^Agotado/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Harina 000' })).toContainText('Agotado');
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Producción de hoy' }) })).toContainText('Harina 000');
});

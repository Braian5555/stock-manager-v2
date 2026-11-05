import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('cámara de congelados: lo producido entra a la cámara y se descuenta al sacarlo para hornear', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/produccion');
  await page.getByLabel('Buscar producto').fill('Harina');
  await page.getByRole('listitem').filter({ hasText: 'Harina 000' }).click();
  await dialog(page).getByRole('button', { name: '+5' }).click();
  await dialog(page).getByRole('button', { name: /^Anotar 5 kg/ }).click();
  await expect(page.getByText('Anotado: 5 kg de Harina 000')).toBeVisible();

  await page.goto('./#/vitrina'); // el link viejo lleva a la cámara
  await expect(page).toHaveURL(/#\/camara/);
  await expect(page.getByRole('heading', { name: 'Cámara de congelados', level: 1 })).toBeVisible();
  const tile = page.getByRole('listitem').filter({ hasText: 'Harina 000' });
  await expect(tile).toContainText('Hoy entró 5');
  await tile.click();
  const m = dialog(page);
  const left = Number((await m.locator('p.muted b.num').first().innerText()).replace(/\./g, '').replace(',', '.'));
  expect(left).toBeGreaterThanOrEqual(5);
  await m.getByRole('button', { name: '+1', exact: true }).click();
  await m.getByRole('button', { name: '+1', exact: true }).click();
  await expect(m.getByRole('group', { name: 'Para qué' }).getByRole('button', { name: 'Al horno · Desayunos' })).toHaveAttribute('aria-pressed', 'true');
  await m.getByRole('button', { name: /^Sacar 2 kg/ }).click();
  await expect(page.getByText(`Al horno: 2 kg de Harina 000 · quedan ${String(left - 2).replace('.', ',')} en la cámara`)).toBeVisible();
  await expect(tile).toContainText('se sacó 2');

  // Sacar todo: pasa a "Se terminó"
  await tile.click();
  await dialog(page).getByRole('button', { name: 'Sacar todo' }).click();
  await expect(page.getByText(/Harina 000 · no queda más en la cámara/)).toBeVisible();
  await page.getByRole('group', { name: 'Mostrar' }).getByRole('button', { name: /^Se terminó/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Harina 000' })).toContainText('No queda');
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Entró hoy a la cámara' }) })).toContainText('Harina 000');
});

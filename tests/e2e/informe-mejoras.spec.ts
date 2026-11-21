import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('factura a mano: renglón sin IA ni foto, carga al stock y avisa si se repite el número', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/facturas');
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  const d = dialog(page);
  await d.getByRole('button', { name: 'Agregar renglón' }).click();
  await d.getByLabel('Buscar producto para agregar a la factura').fill('Harina 000');
  await d.getByRole('button', { name: 'Agregar Harina 000 a la factura' }).first().click();
  const line = d.getByRole('listitem').filter({ hasText: 'Harina 000' });
  await line.getByLabel(/^Cantidad comprada de/).fill('3');
  await expect(line.getByLabel(/^Cantidad en stock de/)).toHaveValue('3');
  await d.getByLabel('Proveedor').fill('Molino Prueba');
  await d.getByLabel(/^Número de factura/).fill('A 0001-00000042');
  await page.screenshot({ path: 'test-results/informe-factura-a-mano.png' });
  await d.getByRole('button', { name: 'Guardar y cargar al stock' }).click();
  await expect(page.getByText(/Factura guardada y cargada al stock \(1 producto\)/)).toBeVisible();

  // La misma factura otra vez: avisa antes de guardarla.
  await d.getByRole('button', { name: 'Cerrar' }).click(); // se cierra la factura que se abrió al guardar
  await page.getByRole('button', { name: /^Nueva factura/ }).click();
  await d.getByRole('button', { name: 'Agregar renglón' }).click();
  await d.getByLabel('Buscar producto para agregar a la factura').fill('Harina 000');
  await d.getByRole('button', { name: 'Agregar Harina 000 a la factura' }).first().click();
  await d.getByLabel('Proveedor').fill('Molino Prueba');
  await d.getByLabel(/^Número de factura/).fill('1-42');
  await d.getByRole('button', { name: 'Guardar factura' }).click();
  await expect(page.getByRole('heading', { name: 'Factura repetida' })).toBeVisible();
});

test('movimientos: corregir el motivo sin revertir', async ({ page, isMobile }) => {
  await loadDemo(page);
  await go(page, '/movimientos');
  await page.getByRole('button', { name: 'Corregir motivo' }).first().click();
  const d = dialog(page);
  await d.getByLabel('Motivo').fill('Producción panadería 20/11');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Motivo corregido')).toBeVisible();
  if (!isMobile) await expect(page.getByRole('cell', { name: /Producción panadería 20\/11 \(corregido\)/ }).first()).toBeVisible();
  else await expect(page.getByText(/Producción panadería 20\/11/).first()).toBeVisible();
});

test('producción: anotar varios productos juntos con un motivo', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/produccion');
  await page.getByRole('button', { name: 'Anotar varios' }).click();
  const d = dialog(page);
  await d.getByLabel('Motivo').fill('Producción 21/11');
  const search = d.getByLabel('Buscar producto para anotar');
  await search.fill('a');
  const first = d.getByRole('button', { name: /^Agregar / }).first();
  const name = ((await first.getAttribute('aria-label')) ?? '').replace(/^Agregar /, '');
  await first.click();
  await d.getByLabel(`Cantidad de ${name}`).fill('12');
  await page.screenshot({ path: 'test-results/informe-anotar-varios.png' });
  await d.getByRole('button', { name: /^Anotar 1/ }).click();
  await expect(page.getByText(/Anotados 1 producto · Producción 21\/11/)).toBeVisible();
});

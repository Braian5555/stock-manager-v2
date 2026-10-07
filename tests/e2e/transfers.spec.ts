import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dialog, go, loadDemo } from './helpers';

test('remitos internos: crear punto, mandar mercadería, Excel para Maxirest, stock del punto y anular', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/remitos');
  await expect(page.getByText('Todavía no hay remitos')).toBeVisible();

  // Crear el punto
  await page.getByRole('button', { name: 'Puntos' }).click();
  await page.getByRole('button', { name: 'Nuevo punto' }).click();
  await dialog(page).getByLabel('Nombre del punto').fill('Parador');
  await dialog(page).getByLabel(/^Nombre en Maxirest/).fill('DEPOSITO PARADOR');
  await dialog(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Punto creado')).toBeVisible();

  // Nuevo remito
  await page.getByRole('link', { name: 'Nuevo remito' }).click();
  await page.getByLabel('Punto que recibe').selectOption({ label: 'Parador' });
  await page.getByLabel('Buscar producto para agregar').fill('harina');
  await page.getByRole('button', { name: 'Agregar Harina 000' }).click();
  await page.getByLabel('Cantidad de Harina 000').fill('10');
  await page.getByLabel('Buscar producto para agregar').fill('tomate');
  await page.getByLabel('Buscar producto para agregar').press('Enter');
  await page.getByLabel('Cantidad de Tomate').fill('12');
  await expect(page.getByText('no alcanza')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(dialog(page).getByText(/Tomate queda con stock negativo/)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(page.getByText('Remito R-0001 registrado')).toBeVisible();

  // Detalle abierto
  await expect(dialog(page).getByRole('heading', { name: 'Remito R-0001' })).toBeVisible();
  await expect(dialog(page).getByText('Pendiente en Maxirest')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cerrar' }).click();

  // Depósito: 25 - 10 = 15 kg de harina
  await go(page, '/stock');
  await page.getByRole('searchbox').first().fill('Harina');
  await expect(page.getByText(/15\s*kg/).first()).toBeVisible();

  // Excel para Maxirest y marcar como cargados
  await go(page, '/remitos');
  await expect(page.getByText('1 remito pendiente de cargar en Maxirest')).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel para Maxirest' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^remitos-para-maxirest_.*\.xlsx$/);
  expect(readFileSync((await file.path())!).subarray(0, 2).toString()).toBe('PK');
  await dialog(page).getByRole('button', { name: 'Sí, marcar como cargados' }).click();
  await expect(page.getByText('1 remitos marcados como cargados en Maxirest.')).toBeVisible();
  await expect(page.getByText(/pendiente de cargar en Maxirest/)).toHaveCount(0);

  // Stock del punto
  await page.getByRole('button', { name: 'Stock por punto' }).click();
  await expect(page.getByText(/10\s*kg/)).toBeVisible();
  await expect(page.getByText(/12\s*kg/)).toBeVisible();

  // Movimientos muestran el lugar
  await go(page, '/movimientos');
  await page.getByLabel('Lugar').selectOption({ label: 'Parador' });
  await expect(page.getByText('Remito R-0001 desde Depósito Central').filter({ visible: true }).first()).toBeVisible();

  // Anular: vuelve al depósito y queda pendiente de revertir en Maxirest
  await go(page, '/remitos');
  await page.getByRole('button', { name: /Remito R-0001 a Parador/ }).click();
  await dialog(page).getByRole('button', { name: 'Anular' }).click();
  await dialog(page).getByRole('button', { name: 'Anular remito' }).click();
  await expect(page.getByText('Remito R-0001 anulado')).toBeVisible();
  await expect(page.getByText('Falta revertirlo en Maxirest')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Stock por punto' }).click();
  await expect(page.getByText(/^0\s*kg$/).first()).toBeVisible();
});

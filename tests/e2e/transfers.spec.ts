import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dialog, enableMaxirest, go, loadDemo } from './helpers';

async function createOutlet(page: import('@playwright/test').Page, name: string) {
  await go(page, '/remitos?tab=puntos');
  await page.getByRole('button', { name: 'Nuevo punto' }).click();
  await dialog(page).getByLabel('Nombre del punto').fill(name);
  await dialog(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Punto creado')).toBeVisible();
}

test('enviar a un punto: sale del Depósito Central, se suma al punto, no se manda más de lo que hay y se puede anular', async ({ page, isMobile }) => {
  await loadDemo(page);
  await go(page, '/remitos');
  await expect(page.getByText('Todavía no hay remitos')).toBeVisible();
  await createOutlet(page, 'Parador');
  // Sin Maxirest: no aparece nada de Maxirest.
  await expect(page.getByText(/Maxirest/)).toHaveCount(0);

  // Desde Stock: "Enviar a un punto"
  await go(page, '/stock');
  await page.getByRole('link', { name: 'Enviar a un punto' }).click();
  await expect(page.getByRole('heading', { name: 'Enviar a un punto' })).toBeVisible();
  await page.getByLabel('Punto que recibe').selectOption({ label: 'Parador' });
  await page.getByLabel('Buscar producto para agregar').fill('harina');
  await page.getByRole('button', { name: 'Agregar Harina 000' }).click();
  await page.getByLabel('Cantidad de Harina 000').fill('10');
  await page.getByLabel('Buscar producto para agregar').fill('tomate');
  await page.getByLabel('Buscar producto para agregar').press('Enter');
  await page.getByLabel('Cantidad de Tomate').fill('12');
  await expect(page.getByText('no alcanza: podés mandar hasta 9')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(page.getByText(/No alcanza el stock del Depósito Central: Tomate/)).toBeVisible();
  await page.getByLabel('Cantidad de Tomate').fill('9');
  await page.getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(dialog(page).getByText('Pendiente de cargar en Maxirest')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(page.getByText('Remito R-0001 registrado')).toBeVisible();
  await expect(dialog(page).getByRole('heading', { name: 'Remito R-0001' })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cerrar' }).click();

  // Depósito: 25 - 10 = 15 kg de harina
  await go(page, '/stock');
  await page.getByRole('searchbox').first().fill('Harina');
  await expect(page.getByText(/15\s*kg/).first()).toBeVisible();

  // Stock del punto
  await go(page, '/remitos?tab=stock');
  await expect(page.getByText(/10\s*kg/)).toBeVisible();
  await expect(page.getByText(/9\s*kg/)).toBeVisible();

  // Movimientos muestran el lugar
  if (!isMobile) {
    await go(page, '/movimientos');
    await page.getByLabel('Lugar').selectOption({ label: 'Parador' });
    await expect(page.getByText('Remito R-0001 desde Depósito Central').filter({ visible: true }).first()).toBeVisible();
  }

  // Anular: vuelve al depósito
  await go(page, '/remitos');
  await page.getByRole('button', { name: /Remito R-0001 a Parador/ }).click();
  await dialog(page).getByRole('button', { name: 'Anular' }).click();
  await dialog(page).getByRole('button', { name: 'Anular remito' }).click();
  await expect(page.getByText('Remito R-0001 anulado')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Stock por punto' }).click();
  await expect(page.getByText('Agua mineral 500 ml')).toBeVisible();
  await expect(page.getByText(/^10\s*kg$/)).toHaveCount(0);
});

test('una salida que no alcanza deja el stock en 0 (no en negativo)', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/stock');
  await page.getByRole('searchbox').first().fill('Tomate');
  await page.getByRole('button', { name: /Registrar movimiento/ }).first().click();
  await dialog(page).getByLabel('Tipo de movimiento').selectOption('salida');
  await dialog(page).getByLabel(/Cantidad/).fill('50');
  await expect(dialog(page).getByText(/No alcanza: hay 9/)).toBeVisible();
  await expect(dialog(page).getByText(/en negativo/)).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Registrar' }).click();
  await go(page, '/movimientos');
  await expect(page.getByText(/no alcanzaba: faltaban 41/).filter({ visible: true }).first()).toBeVisible();
});

test('con Maxirest: el remito queda pendiente, Excel y marcar cargados', async ({ page, isMobile }) => {
  test.skip(isMobile, 'una sola vez alcanza');
  await loadDemo(page);
  await enableMaxirest(page);
  await createOutlet(page, 'Parador');
  await go(page, '/remitos/nuevo');
  await page.getByLabel('Punto que recibe').selectOption({ label: 'Parador' });
  await page.getByLabel('Buscar producto para agregar').fill('harina');
  await page.getByRole('button', { name: 'Agregar Harina 000' }).click();
  await page.getByLabel('Cantidad de Harina 000').fill('5');
  await page.getByRole('button', { name: 'Confirmar remito' }).click();
  await dialog(page).getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(dialog(page).getByText('Pendiente en Maxirest')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByText('1 remito pendiente de cargar en Maxirest')).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel para Maxirest' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^remitos-para-maxirest_.*\.xlsx$/);
  expect(readFileSync((await file.path())!).subarray(0, 2).toString()).toBe('PK');
  await dialog(page).getByRole('button', { name: 'Sí, marcar como cargados' }).click();
  await expect(page.getByText('1 remitos marcados como cargados en Maxirest.')).toBeVisible();
});

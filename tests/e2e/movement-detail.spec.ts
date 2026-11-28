import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('tocar un movimiento muestra su detalle y lo que vino en la misma operación', async ({ page }) => {
  await loadDemo(page);
  // Un conteo con dos ajustes: los dos movimientos quedan unidos por el conteo.
  await go(page, '/conteo');
  await page.getByRole('button', { name: 'Nuevo conteo' }).click();
  await dialog(page).getByLabel('Ubicación').selectOption({ label: 'Cámara de verduras' });
  await dialog(page).getByRole('button', { name: 'Empezar conteo' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Sumar 1 a Papa' }).click();
  await page.getByLabel('Cantidad contada de Tomate').fill('7');
  await page.getByRole('button', { name: 'Finalizar conteo' }).click();
  await page.getByRole('button', { name: 'Aplicar al stock' }).click();
  await dialog(page).getByRole('button', { name: 'Aplicar ajustes' }).click();
  await expect(page.getByText('Conteo aplicado: 2 ajustes registrados.')).toBeVisible();

  await go(page, '/movimientos');
  await page.getByRole('button', { name: /^Ver detalle: Papa,/ }).filter({ visible: true }).first().click();
  const d = page.getByRole('dialog', { name: 'Detalle del movimiento' });
  await expect(d).toBeVisible();
  await expect(d).toContainText('Papa');
  await expect(d.getByRole('definition').filter({ hasText: '0 → 3' })).toBeVisible();
  await expect(d).toContainText('Conteo');
  await expect(page).toHaveURL(/mov=/);
  await page.screenshot({ path: 'test-results/movimiento-detalle.png' });

  // Desde el detalle se pasa al otro movimiento del mismo conteo.
  const misma = d.getByRole('region', { name: 'Movimientos de la misma operación' });
  await expect(misma).toContainText('En la misma operación (1)');
  await misma.getByRole('button', { name: 'Ver movimiento de Tomate' }).click();
  await expect(d).toContainText('Tomate');
  await d.getByRole('button', { name: 'Cerrar' }).last().click();
  await expect(d).toBeHidden();
  await expect(page).not.toHaveURL(/mov=/);
});

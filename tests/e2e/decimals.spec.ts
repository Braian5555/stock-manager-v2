import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('cantidades con coma (teclado del celular): movimiento y conteo', async ({ page }) => {
  await loadDemo(page);
  // Movimiento: tipear "2,5" tecla por tecla, como en el celular.
  await go(page, '/stock');
  await page.getByRole('searchbox').first().fill('Harina 000');
  await page.getByRole('article', { name: 'Harina 000' }).getByRole('button', { name: 'Registrar movimiento' }).click();
  const d = dialog(page);
  const qty = d.getByLabel(/^Cantidad/);
  await qty.pressSequentially('2,5');
  await expect(qty).toHaveValue('2,5');
  await expect(d.getByText(/\+2,5/)).toBeVisible();
  // Cantidad 0: no se registra un movimiento vacío.
  await qty.fill('0');
  await d.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('La cantidad tiene que ser mayor a 0.')).toBeVisible();
  await qty.fill('');
  await qty.pressSequentially('2,5');
  await d.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText(/Ingreso registrado/)).toBeVisible();

  // Conteo: "1,5" tecla por tecla en el campo del conteo.
  await go(page, '/conteo');
  await page.getByRole('button', { name: 'Nuevo conteo' }).click();
  await dialog(page).getByRole('button', { name: 'Empezar conteo' }).click();
  const field = page.getByLabel('Cantidad contada de Harina 000');
  await field.pressSequentially('1,5');
  await expect(field).toHaveValue('1,5');
  await page.waitForTimeout(400);
  await expect(field).toHaveValue('1,5');
});

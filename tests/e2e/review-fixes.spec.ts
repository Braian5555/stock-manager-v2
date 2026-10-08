import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('saltar al contenido no navega a una página inexistente', async ({ page, isMobile }) => {
  test.skip(isMobile, 'navegación con teclado');
  await loadDemo(page);
  await go(page, '/stock');
  await page.getByRole('link', { name: 'Saltar al contenido' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/stock$/);
  await expect(page.locator('main#contenido')).toBeFocused();
});

test('Esc en una confirmación cierra sólo la confirmación y la página sigue con scroll', async ({ page, isMobile }) => {
  test.skip(isMobile, 'teclado');
  await loadDemo(page);
  await go(page, '/remitos?tab=puntos');
  await page.getByRole('button', { name: 'Nuevo punto' }).click();
  await dialog(page).getByLabel('Nombre del punto').fill('Parador');
  await dialog(page).getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Editar Parador' }).click();
  await dialog(page).getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Editar punto' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

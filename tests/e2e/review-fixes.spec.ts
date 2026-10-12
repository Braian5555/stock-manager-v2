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
  // Escanear un código desconocido → asignar a un producto → aparece la confirmación encima.
  await go(page, '/stock');
  await page.getByRole('button', { name: 'Escanear' }).click();
  await dialog(page).last().getByRole('textbox', { name: 'Código de barras' }).fill('SM009999');
  await dialog(page).last().getByRole('button', { name: 'Buscar' }).click();
  await dialog(page).last().getByRole('button', { name: 'Asignar a un producto' }).click();
  await dialog(page).last().getByRole('button', { name: /Harina 000/ }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Asignar SM009999' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Volver de "Asignar" muestra de nuevo el resultado del escaneo; Esc lo cierra.
  await expect(page.getByRole('heading', { name: 'Código no encontrado' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

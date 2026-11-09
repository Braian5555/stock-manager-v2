import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('sin recetas: productos, carta y configuración sin nada de recetas; se pueden volver a prender', async ({ page }) => {
  await loadDemo(page);
  // Ficha de producto: sin receta.
  await go(page, '/productos');
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await expect(dialog(page).getByLabel('Nombre')).toBeVisible();
  await expect(dialog(page).getByRole('group', { name: 'Receta' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  // Carta: sin receta ni costo.
  await go(page, '/salon?vista=carta');
  await page.getByRole('button', { name: /Agregar (a la carta|el primero)/ }).first().click();
  await expect(dialog(page).getByLabel('Nombre')).toBeVisible();
  await expect(dialog(page).getByRole('group', { name: 'Receta' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  // Configuración: "Stock al vender" (recetas de la carta) no aparece; el interruptor está apagado.
  await go(page, '/salon/configuracion');
  await expect(page.getByRole('link', { name: /Stock al vender/ })).toHaveCount(0);
  await go(page, '/configuracion/stock');
  const sw = page.getByRole('checkbox', { name: 'Usar recetas' });
  await expect(sw).not.toBeChecked();
  await expect(page.getByText(/el stock es sólo de productos/)).toBeVisible();

  // Prendidas: vuelve la receta en la ficha.
  await sw.click();
  await expect(sw).toBeChecked();
  await go(page, '/productos');
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await expect(dialog(page).getByRole('group', { name: 'Receta' })).toBeVisible();
});

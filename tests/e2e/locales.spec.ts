import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('locales: cada equipo trabaja en su local y no se cruzan mesas, ventas ni caja', async ({ page, isMobile }) => {
  test.skip(isMobile, 'se configura en la compu');
  await loadDemo(page);
  // Antes de los locales: 2 mesas (quedan en el primer local).
  await go(page, '/salon');
  await page.getByLabel('Cantidad de mesas').fill('2');
  await page.getByRole('button', { name: 'Crear mesas' }).click();
  await expect(page.getByRole('button', { name: 'Mesa 2: Libre' })).toBeVisible();

  await go(page, '/configuracion/locales');
  await expect(page.getByRole('heading', { name: 'Locales', level: 1 })).toBeVisible();
  for (const [name, code, pv] of [['Xenote', '10', '10'], ['Kiosco', '8', '8']]) {
    await page.getByRole('button', { name: 'Nuevo local' }).click();
    const m = dialog(page);
    await m.getByLabel('Nombre del local').fill(name);
    await m.getByLabel('Número de local').fill(code);
    await m.getByLabel('Punto de venta de ARCA').fill(pv);
    await m.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
  }
  await expect(page.getByRole('row', { name: /Xenote/ })).toContainText('10');

  // El Salón pide elegir el local del equipo.
  await go(page, '/salon');
  await expect(page.getByRole('heading', { name: '¿En qué local trabaja este equipo?' })).toBeVisible();
  await page.getByRole('button', { name: /^10\s*Xenote/ }).click();
  await expect(page.getByRole('button', { name: 'Mesa 1: Libre' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Local de este equipo: Xenote' })).toBeVisible();

  // El equipo pasa al Kiosco: no ve las mesas del Xenote; crea las suyas.
  await go(page, '/configuracion/locales');
  await page.getByRole('combobox', { name: 'Local de este equipo' }).selectOption({ label: '8 · Kiosco' });
  await go(page, '/salon');
  await expect(page.getByRole('button', { name: /^Mesa 1:/ })).toHaveCount(0);
  await page.getByLabel('Cantidad de mesas').fill('3');
  await page.getByRole('button', { name: 'Crear mesas' }).click();
  await expect(page.getByRole('button', { name: 'Mesa 3: Libre' })).toBeVisible();

  // Vuelve al Xenote: siguen sus 2 mesas, sin las 3 del Kiosco.
  await go(page, '/configuracion/locales');
  await page.getByRole('combobox', { name: 'Local de este equipo' }).selectOption({ label: '10 · Xenote' });
  await go(page, '/salon');
  await expect(page.getByRole('button', { name: 'Mesa 2: Libre' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Mesa 3:/ })).toHaveCount(0);
});

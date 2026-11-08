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

test('central: la "aplicación madre" ve todos los locales y opera uno por vez', async ({ page, isMobile }) => {
  test.skip(isMobile, 'la central es la compu de la administración');
  await loadDemo(page);
  await go(page, '/configuracion/locales');
  for (const [name, pv] of [['Xenote', '10'], ['Kiosco', '8']]) {
    await page.getByRole('button', { name: 'Nuevo local' }).click();
    const m = dialog(page);
    await m.getByLabel('Nombre del local').fill(name);
    await m.getByLabel('Punto de venta de ARCA').fill(pv);
    await m.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
  }
  await page.getByRole('combobox', { name: 'Local de este equipo' }).selectOption({ label: 'Central (todos los locales)' });

  // Resumen con todos los locales.
  await go(page, '/');
  const table = page.getByRole('table', { name: 'Locales hoy' });
  await expect(table.getByRole('row', { name: /Xenote/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /Kiosco/ })).toBeVisible();
  const picker = page.getByRole('button', { name: /^Central: local a mirar/ });
  await expect(picker).toHaveAccessibleName('Central: local a mirar: todos los locales');
  // La lista de la Central: con teclado y con el mouse.
  await picker.click();
  const list = page.getByRole('listbox', { name: '¿Qué local mirar?' });
  await expect(list.getByRole('option', { name: /Todos los locales/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await picker.click();
  await list.getByRole('option', { name: /Xenote/ }).click();
  await expect(picker).toHaveAccessibleName('Central: local a mirar: Xenote');
  await picker.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveAccessibleName('Central: local a mirar: todos los locales');

  // Para operar, elige el local.
  await go(page, '/salon');
  await expect(page.getByRole('heading', { name: '¿Qué local querés operar?' })).toBeVisible();
  await page.getByRole('button', { name: /Kiosco/ }).click();
  await expect(page.getByLabel('Cantidad de mesas')).toBeVisible();
  await page.getByLabel('Cantidad de mesas').fill('1');
  await page.getByRole('button', { name: 'Crear mesas' }).click();
  await expect(page.getByRole('button', { name: 'Mesa 1: Libre' })).toBeVisible();

  // Vuelve a "todos": las ventas del día se pueden ver; operar pide local otra vez.
  await page.getByRole('button', { name: /^Central: local a mirar/ }).click();
  await page.getByRole('option', { name: /Todos los locales/ }).click();
  await expect(page.getByRole('button', { name: 'Central: local a mirar: todos los locales' })).toBeVisible();
  await go(page, '/salon?vista=hoy');
  await expect(page.getByRole('heading', { name: 'Ventas de hoy', level: 1 })).toBeVisible();
});

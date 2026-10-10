import { expect, test, type Page } from '@playwright/test';
import { go, loadDemo } from './helpers';

const top = (page: Page) => page.getByRole('dialog').last();

async function typeCode(page: Page, code: string) {
  const d = top(page);
  await d.getByLabel('Código de barras').fill(code);
  await d.getByRole('button', { name: 'Buscar' }).click();
}

test('escanear: código desconocido → asignar a un producto → ver stock → ingreso sin cantidad automática', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/stock');
  await page.getByRole('button', { name: 'Escanear' }).click();

  // Sin cámara en la prueba: el permiso sólo se pide al tocar el botón y el error es claro.
  await top(page).getByRole('button', { name: 'Activar cámara' }).click();
  await expect(top(page).getByText(/cámara/i).first()).toBeVisible();
  await expect(top(page).getByRole('button', { name: 'Reintentar' })).toBeVisible({ timeout: 10_000 });

  await typeCode(page, '7790001234567');
  await expect(top(page).getByRole('heading', { name: 'Código no encontrado' })).toBeVisible();
  await expect(top(page).getByText('7790001234567')).toBeVisible();

  await top(page).getByRole('button', { name: 'Asignar a un producto' }).click();
  await top(page).getByLabel('Buscar producto para asignar').fill('Harina 000');
  await top(page).getByRole('button', { name: /Harina 000/ }).first().click();
  await top(page).getByRole('button', { name: 'Asignar código' }).click();

  const card = top(page);
  await expect(card.getByRole('heading', { name: /Harina 000/ })).toBeVisible();
  const before = Number((await card.locator('.scan-stock-num').innerText()).replace(/\./g, '').replace(',', '.'));
  await card.getByRole('button', { name: 'Ingreso' }).click();

  const m = top(page);
  await expect(m.getByLabel('Tipo de movimiento')).toHaveValue('ingreso');
  await expect(m.getByLabel('Cantidad')).toHaveValue('');
  await m.getByLabel('Cantidad').fill('2');
  await m.getByRole('button', { name: 'Registrar' }).click();
  await expect(top(page).locator('.scan-stock-num')).toHaveText(String(before + 2));

  // Escanear de nuevo el mismo código: aparece directo.
  await top(page).getByRole('button', { name: 'Escanear otro' }).click();
  await typeCode(page, '7790001234567');
  await expect(top(page).getByRole('heading', { name: /Harina 000/ })).toBeVisible();
});

test('código nuevo: crear producto sólo al confirmar, y no se repiten códigos', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/productos');
  const total = async () => Number((await page.locator('.page-head, header').getByText(/\d+ productos/).first().innerText()).match(/\d+/)![0]);
  const start = await total();

  await page.getByRole('button', { name: 'Escanear' }).click();
  await typeCode(page, 'SM000777');
  await top(page).getByRole('button', { name: 'Crear producto' }).click();
  await expect(top(page).getByRole('textbox', { name: 'Código de barras' })).toHaveValue('SM000777');
  await top(page).getByRole('button', { name: 'Cancelar' }).click();
  // Cancelar no crea nada.
  await expect(top(page).getByRole('heading', { name: 'Código no encontrado' })).toBeVisible();
  await top(page).getByRole('button', { name: 'Cerrar' }).click();
  expect(await total()).toBe(start);

  await page.getByRole('button', { name: 'Escanear' }).click();
  await typeCode(page, 'SM000777');
  await top(page).getByRole('button', { name: 'Crear producto' }).click();
  await top(page).getByLabel('Nombre').fill('Servilletas con código');
  await top(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(top(page).getByRole('heading', { name: 'Servilletas con código' })).toBeVisible();
  await top(page).getByRole('button', { name: 'Cerrar' }).click();
  await expect.poll(total).toBe(start + 1);

  // Otro producto con el mismo código: avisa y no guarda.
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await top(page).getByLabel('Nombre').fill('Duplicado');
  await top(page).getByRole('textbox', { name: 'Código de barras' }).fill('sm000777');
  await expect(top(page).getByText('Ya lo tiene “Servilletas con código”.')).toBeVisible();
  await top(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(/ya es de “Servilletas con código”/)).toBeVisible();
  await top(page).getByRole('button', { name: 'Cancelar' }).click();
  expect(await total()).toBe(start + 1);
});

test('conteo y etiquetas: escanear ubica el renglón; etiquetas imprimibles con código', async ({ page }) => {
  await loadDemo(page);
  // Cargar un código desde el formulario (botón Generar = código interno).
  await go(page, '/productos');
  await page.getByRole('button', { name: /^Editar Harina 000/ }).first().click();
  await top(page).getByRole('button', { name: 'Generar' }).click();
  const code = await top(page).getByRole('textbox', { name: 'Código de barras' }).inputValue();
  expect(code).toMatch(/^SM\d{6}$/);
  await top(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Conteo: escanear lleva al producto y deja el cursor en la cantidad, sin cargar números.
  await go(page, '/conteo');
  await page.getByRole('button', { name: 'Nuevo conteo' }).click();
  await top(page).getByRole('button', { name: 'Empezar conteo' }).click();
  await page.getByRole('button', { name: 'Escanear' }).click();
  await typeCode(page, code.toLowerCase());
  const row = page.locator('.count-item.scan-hit');
  await expect(row).toHaveCount(1);
  await expect(row.getByText(/Harina 000/)).toBeVisible();
  await expect(row.locator('input')).toBeFocused();
  await expect(row.locator('input')).toHaveValue('');

  // Código que no existe: mensaje claro.
  await page.getByRole('button', { name: 'Escanear' }).click();
  await typeCode(page, '0000000000000');
  await expect(page.getByText('No hay ningún producto con el código 0000000000000.')).toBeVisible();

  // Etiquetas
  await go(page, '/productos');
  await page.evaluate(() => { window.print = () => { (window as unknown as { __printed: number }).__printed = document.querySelectorAll('.print-labels .label svg').length; }; });
  await page.getByRole('button', { name: 'Etiquetas' }).click();
  const d = top(page);
  await d.getByRole('button', { name: 'Ninguno' }).click();
  await d.getByRole('checkbox', { name: /Harina 000/ }).first().check();
  await d.getByRole('button', { name: /Imprimir 1 etiquetas/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: number }).__printed)).toBe(1);
});

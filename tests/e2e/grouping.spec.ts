import { expect, test } from '@playwright/test';
import { go, loadDemo } from './helpers';

test('productos y conteo: agrupar por familia, ubicación o unidad y ver un solo grupo', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/productos');
  const chips = page.getByRole('group', { name: 'Grupos' });
  await expect(chips.getByRole('button', { name: /^Todos/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Agrupar por' }).getByRole('button', { name: 'Unidad' }).click();
  await expect(page).toHaveURL(/agrupar=unidad/);
  const kilos = chips.getByRole('button', { name: /^Kilogramos/ });
  await kilos.click();
  await expect(kilos).toHaveAttribute('aria-pressed', 'true');
  const rows = page.locator('table tbody tr:not(.group-row)');
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await expect(rows.nth(i).locator('td[data-label="Stock"]')).toContainText('kg');
  // Abrir y cerrar un producto no pierde el grupo elegido.
  await rows.first().getByRole('button', { name: /^Editar/ }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/grupo=/);

  // En el conteo, por familia
  await go(page, '/conteo');
  await page.getByRole('button', { name: 'Nuevo conteo' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Empezar conteo' }).click();
  await expect(page.getByRole('group', { name: 'Agrupar por' })).toBeVisible();
  await expect(page.locator('.group-head').first()).toBeVisible();
  const first = page.getByRole('group', { name: 'Grupos' }).getByRole('button').nth(1);
  const label = (await first.textContent())!.replace(/\s*\d+$/, '').trim();
  await first.click();
  await expect(page.locator('.group-head')).toHaveCount(1);
  await expect(page.locator('.group-head')).toContainText(label);
});

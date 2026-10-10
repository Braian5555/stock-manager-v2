import { expect, test, type Page } from '@playwright/test';
import { go, loadDemo } from './helpers';

const top = (page: Page) => page.getByRole('dialog').last();

test('alertas: filtrar para reponer / sin stock y cargar mínimos en lote con deshacer', async ({ page }) => {
  await loadDemo(page);
  // Un producto sin mínimo
  await go(page, '/productos');
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await top(page).getByLabel('Nombre').fill('Café en grano');
  await top(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await go(page, '/stock');
  const reponer = page.getByRole('button', { name: /para reponer/ });
  await reponer.click();
  await expect(reponer).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Estado: Bajo y crítico')).toBeVisible();
  await reponer.click();
  await expect(page.getByText('Estado: Bajo y crítico')).toHaveCount(0);
  await page.getByRole('button', { name: /sin stock$/ }).click();
  await expect(page.getByText('Estado: Sin stock')).toBeVisible();

  await expect(page.getByText(/no tiene mínimo cargado/)).toBeVisible();
  await page.getByRole('link', { name: 'Cargar mínimos' }).click();
  await expect(page.getByRole('button', { name: 'Quitar filtro sin mínimo' })).toBeVisible();
  await expect(page.locator('tbody tr:not(.group-row)')).toHaveCount(1);

  await page.getByRole('button', { name: 'Elegir los 1' }).click();
  await page.getByRole('button', { name: 'Cambiar…' }).click();
  await top(page).getByLabel('Qué cambiar').selectOption({ label: 'Mínimo y máximo' });
  await top(page).getByLabel('Mínimo').fill('2');
  await top(page).getByLabel('Máximo').fill('6');
  await expect(top(page).getByText(/El stock no se toca/)).toBeVisible();
  await top(page).getByRole('button', { name: 'Aplicar a 1 producto' }).click();
  await expect(page.getByText('1 producto actualizado.')).toBeVisible();
  await expect(page.locator('tbody tr:not(.group-row)')).toHaveCount(0);

  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('tbody tr:not(.group-row)')).toHaveCount(1);
});

test('elegir varios productos y cambiarles la familia', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/productos');
  await page.getByRole('button', { name: 'Elegir varios' }).click();
  await page.getByRole('checkbox', { name: 'Elegir Hielo 10 kg' }).check();
  await page.getByRole('checkbox', { name: 'Elegir Hielo 5 kg' }).check();
  await expect(page.getByRole('region', { name: 'Productos elegidos' })).toContainText('2 elegidos');
  await page.getByRole('button', { name: 'Cambiar…' }).click();
  await top(page).getByLabel('Nuevo valor').selectOption({ label: 'Bebidas' });
  await expect(top(page).getByText(/familia: Bebidas/)).toBeVisible();
  await top(page).getByRole('button', { name: 'Aplicar a 2 productos' }).click();
  await expect(page.getByText('2 productos actualizados.')).toBeVisible();
  await page.getByRole('button', { name: 'Terminar' }).click();
  await page.getByRole('searchbox').fill('Hielo');
  const rows = page.locator('tbody tr:not(.group-row)');
  await expect(rows).toHaveCount(2);
  for (const r of await rows.all()) await expect(r).toContainText('Bebidas');
});

test('conteo auditable: quién empezó y contó, y Excel de diferencias', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/conteo');
  await page.getByRole('button', { name: 'Nuevo conteo' }).click();
  await top(page).getByRole('button', { name: 'Empezar conteo' }).click();
  await expect(page.getByText(/Empezado .* por Admin Prueba/)).toBeVisible();
  await page.getByRole('searchbox').fill('Sal fina');
  const row = page.locator('.count-item').filter({ hasText: 'Sal fina' });
  await row.locator('input').fill('3');
  await row.locator('input').blur();
  await expect(row).toContainText('Admin Prueba');
  await page.getByRole('button', { name: 'Finalizar conteo' }).click();
  await top(page).getByRole('button', { name: 'Finalizar' }).click();
  await expect(page.getByText(/finalizado .* por Admin Prueba/)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel de diferencias' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^conteo-.*\.xlsx$/);
});

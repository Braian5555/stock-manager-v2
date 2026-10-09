import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo, login } from './helpers';

test('producción: usuario panadero ve sólo Producción, anota con dos toques y suma al stock', async ({ page, isMobile }) => {
  await loadDemo(page);
  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Panadero');
  await d.getByLabel(/^PIN( ·|$)/).fill('2468');
  await d.getByLabel('Repetí el PIN').fill('2468');
  await d.getByLabel('Rol').selectOption('production');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Panadero', { exact: true })).toBeVisible();

  if (isMobile) {
    await go(page, '/mas');
    await page.getByRole('button', { name: 'Bloquear / cambiar usuario' }).click();
  } else {
    await page.getByRole('button', { name: /^Usuario:/ }).click();
    await page.getByRole('menuitem', { name: 'Bloquear / cambiar usuario' }).click();
  }
  await login(page, 'Panadero', '2468');

  // Entra directo a Producción; la navegación sólo ofrece Producción.
  await expect(page.getByRole('heading', { name: 'Producción', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/produccion$/);
  const nav = page.getByRole('navigation', { name: isMobile ? 'Navegación inferior' : 'Navegación principal' });
  await expect(nav.getByRole('link', { name: 'Producción' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Stock' })).toHaveCount(0);

  // Busca, toca y anota 12
  await page.getByLabel('Buscar producto').fill('Harina');
  await page.getByRole('listitem').filter({ hasText: 'Harina 000' }).click();
  const m = dialog(page);
  await m.getByRole('button', { name: '+5' }).click();
  await m.getByRole('button', { name: '+1', exact: true }).click();
  await m.getByRole('button', { name: /^Anotar 6 kg/ }).click();
  await expect(page.getByText('Anotado: 6 kg de Harina 000')).toBeVisible();
  const today = page.locator('section', { has: page.getByRole('heading', { name: 'Anotado hoy' }) });
  await expect(today).toContainText('Harina 000');
  await expect(today).toContainText('+6');
  await expect(today).toContainText('Panadero');

  // La próxima vez aparece en "Lo de siempre"
  await page.getByLabel('Buscar producto').fill('');
  await expect(page.getByRole('button', { name: 'Lo de siempre' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('listitem').filter({ hasText: 'Harina 000' })).toBeVisible();

  // Deshacer
  await today.getByRole('button', { name: /^Deshacer/ }).click();
  await expect(today).toContainText('deshecho');

  // Cualquier otra sección lo devuelve a Producción
  await page.goto('./#/stock');
  await expect(page).toHaveURL(/#\/produccion$/);
});

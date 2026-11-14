import { expect, test } from '@playwright/test';
import { ensureSession } from './helpers';

test('la app viene sólo de stock: sin Salón, sin ventas ni local; se prende desde Configuración', async ({ page, isMobile }) => {
  await page.goto('./');
  await ensureSession(page, { salon: false });

  // Inicio: sin pedir el local, sin ventas ni mesas; con lo del stock.
  await expect(page.getByRole('heading', { name: '¿En qué local trabaja este equipo?' })).toHaveCount(0);
  await expect(page.getByText('vendido hoy')).toHaveCount(0);
  await expect(page.getByText('mesas ocupadas')).toHaveCount(0);
  await expect(page.getByText('en negativo').first()).toBeVisible();
  if (!isMobile) {
    const nav = page.getByRole('navigation', { name: 'Menú principal' });
    await expect(nav.getByRole('link', { name: 'Stock' }).first()).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Mesas' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Caja' })).toHaveCount(0);
  }

  // Un enlace viejo al Salón lleva al Stock.
  await page.goto('./#/salon');
  await expect(page).toHaveURL(/#\/stock$/);
  await page.goto('./#/cocina');
  await expect(page).toHaveURL(/#\/stock$/);

  // Prenderlo vuelve a mostrar todo (no se borró nada).
  await page.goto('./#/configuracion/navegacion');
  const box = page.getByRole('checkbox', { name: /Usar el Salón/ });
  await expect(box).not.toBeChecked();
  await expect(page.getByText('Apagado: la app es sólo de stock')).toBeVisible();
  await box.click();
  await expect(box).toBeChecked();
  await page.goto('./#/salon');
  await expect(page).toHaveURL(/#\/salon/);
  await expect(page.locator('main h1').first()).toBeVisible();
});

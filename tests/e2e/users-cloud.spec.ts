import { expect, test } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

test('usuarios con nube: muestra quién recibe sus permisos e invita al guardar', async ({ page }) => {
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
  await loadDemo(page);
  await go(page, '/nube');
  await page.getByRole('button', { name: 'Entrar con una cuenta de Google' }).click();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Nico');
  await d.getByLabel(/^Email para entrar/).fill('nico@ejemplo.com');
  await d.getByLabel(/^PIN/).fill('4321');
  await d.getByLabel('Repetí el PIN').fill('4321');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Invitación lista para nico@ejemplo.com')).toBeVisible();
  const row = page.locator('.list-item', { hasText: 'nico@ejemplo.com' });
  await expect(row).toContainText('Invitación pendiente');
  // En Cuenta y nube figura la invitación.
  await go(page, '/nube');
  await expect(page.getByText('Invitaciones pendientes')).toBeVisible();
  await expect(page.getByText('nico@ejemplo.com').first()).toBeVisible();
});

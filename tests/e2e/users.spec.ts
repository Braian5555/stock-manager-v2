import { expect, test } from '@playwright/test';
import { ADMIN, dialog, go, loadDemo, login } from './helpers';

test('usuarios: crear empleado, permisos, bloqueo y registro de quién hizo cada movimiento', async ({ page, isMobile }) => {
  await loadDemo(page);
  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const d = dialog(page);
  await d.getByLabel('Nombre').fill('Juan Empleado');
  await d.getByLabel(/^PIN( ·|$)/).fill('5678');
  await d.getByLabel('Repetí el PIN').fill('5678');
  await expect(d.getByLabel('Rol')).toHaveValue('staff');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Juan Empleado')).toBeVisible();

  // Bloquear y entrar como el empleado
  if (isMobile) {
    await go(page, '/mas');
    await page.getByRole('button', { name: 'Bloquear / cambiar usuario' }).click();
  } else {
    await page.getByRole('button', { name: /^Usuario:/ }).click();
    await page.getByRole('menuitem', { name: 'Bloquear / cambiar usuario' }).click();
  }
  await expect(page.getByRole('heading', { name: '¿Quién sos?' })).toBeVisible();

  // PIN incorrecto
  await page.locator('.user-tile', { hasText: 'Juan Empleado' }).click();
  for (const n of '0000') await page.getByRole('button', { name: `Número ${n}` }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('PIN incorrecto.');

  await login(page, 'Juan Empleado', '5678');
  await expect(page.locator('main#contenido')).toBeVisible();

  // El empleado no ve administración ni puede editar productos
  await page.goto('./#/configuracion');
  await expect(page.getByText('No tenés permiso para esta sección')).toBeVisible();
  await go(page, '/stock');
  await expect(page.getByRole('button', { name: 'Registrar movimiento' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Editar' })).toHaveCount(0);

  // Sí puede contar: lo que aplica queda a nombre de quien aplica (el admin)
  await go(page, '/conteo');
  await page.getByRole('button', { name: 'Nuevo conteo' }).click();
  await dialog(page).getByLabel('Ubicación').selectOption({ label: 'Cámara de verduras' });
  await dialog(page).getByRole('button', { name: 'Empezar conteo' }).click();
  await page.getByLabel('Cantidad contada de Tomate').fill('7');
  await page.getByRole('button', { name: 'Finalizar conteo' }).click();
  await dialog(page).getByRole('button', { name: 'Finalizar' }).click();
  await expect(page.getByRole('button', { name: 'Aplicar al stock' })).toHaveCount(0); // staff no aplica

  // La sesión sigue al recargar
  await page.reload();
  await expect(page.locator('main#contenido')).toBeVisible();

  // Vuelve el admin, aplica el conteo y queda registrado a su nombre
  if (isMobile) {
    await go(page, '/mas');
    await page.getByRole('button', { name: 'Bloquear / cambiar usuario' }).click();
  } else {
    await page.getByRole('button', { name: /^Usuario:/ }).click();
    await page.getByRole('menuitem', { name: 'Bloquear / cambiar usuario' }).click();
  }
  await login(page, ADMIN.name, ADMIN.pin);
  await go(page, '/conteo');
  await page.locator('.list-item').first().click();
  await page.getByRole('button', { name: 'Aplicar al stock' }).click();
  await dialog(page).getByRole('button', { name: 'Aplicar ajustes' }).click();
  await go(page, '/movimientos');
  await expect(page.locator('tbody tr, .list-item').filter({ visible: true }).first()).toContainText(ADMIN.name);
});

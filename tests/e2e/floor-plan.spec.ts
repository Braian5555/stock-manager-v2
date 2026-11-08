import { expect, test } from '@playwright/test';
import { go, loadDemo } from './helpers';

test('plano: piso, elementos, deshacer, armados y candado', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/salon');
  await page.getByLabel('Cantidad de mesas').fill('6');
  await page.getByRole('button', { name: 'Crear mesas' }).click();
  const plan = page.getByRole('group', { name: 'Plano del salón' });
  await expect(plan.getByRole('button', { name: 'Mesa 6: Libre' })).toBeVisible();

  // Taller: piso, elementos y deshacer.
  await page.getByRole('button', { name: 'Editar plano' }).click();
  const ws = page.getByRole('toolbar', { name: 'Editar plano' });
  await ws.getByRole('button', { name: 'Arena' }).click();
  await expect(plan).toHaveClass(/floor-arena/);
  await ws.getByRole('button', { name: 'Madera' }).click();
  await expect(plan).toHaveClass(/floor-madera/);
  await ws.getByRole('button', { name: 'Deshacer' }).click();
  await expect(plan).toHaveClass(/floor-arena/);
  await ws.getByRole('button', { name: 'Agregar barra' }).click();
  await expect(plan.getByRole('button', { name: 'Elemento: Barra' })).toBeVisible();
  await expect(ws).toContainText('Barra');
  await ws.getByRole('button', { name: 'Girar' }).click();
  await expect(plan.getByRole('button', { name: 'Elemento: Barra' })).toHaveClass(/is-vertical/);
  await ws.getByRole('button', { name: 'Acomodar en filas' }).click();
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(plan.getByRole('img', { name: 'Barra' })).toBeVisible();

  // Armado "Día".
  await page.getByRole('button', { name: /^Armados del plano/ }).click();
  const box = page.getByRole('dialog', { name: 'Armados de Salón' });
  await box.getByRole('button', { name: 'Día' }).click();
  await box.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(box.getByText('En uso · 6 mesas')).toBeVisible();
  await page.keyboard.press('Escape');
  if (await box.isVisible()) await box.getByRole('button', { name: 'Cerrar' }).click();

  // Se mueve una mesa con el teclado: el armado queda "con cambios"; volver a él la pone en su lugar.
  await page.getByRole('button', { name: 'Editar plano' }).click();
  const t1 = plan.getByRole('button', { name: 'Mesa 1: Libre' });
  const before = await t1.getAttribute('style');
  await t1.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(t1).not.toHaveAttribute('style', before!);
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByRole('button', { name: 'Armados del plano: Día (con cambios)' })).toBeVisible();
  await page.getByRole('button', { name: /^Armados del plano/ }).click();
  await expect(box.getByText('En uso · con cambios · 6 mesas')).toBeVisible();
  await box.getByRole('button', { name: 'Volver a Día' }).click();
  await page.getByRole('dialog', { name: 'Volver a “Día”' }).getByRole('button', { name: 'Volver' }).click();
  await expect(t1).toHaveAttribute('style', before!);
  await expect(page.getByRole('button', { name: 'Armados del plano: Día' })).toBeVisible();

  // Candado: no se edita hasta desbloquear.
  await page.getByRole('button', { name: 'Bloquear plano' }).click();
  await expect(page.getByRole('button', { name: 'Editar plano' })).toHaveCount(0);
  await expect(plan.getByText('Bloqueado')).toBeVisible();
  // En el servicio las mesas se siguen abriendo.
  await page.getByRole('button', { name: 'Desbloquear plano' }).click();
  await expect(page.getByRole('button', { name: 'Editar plano' })).toBeVisible();
});

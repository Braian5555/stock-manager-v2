import { expect, test } from '@playwright/test';
import { go, loadDemo } from './helpers';

test('diagnóstico: la app se revisa y arma el informe para Claude', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/diagnostico');
  await expect(page.getByRole('heading', { name: 'Diagnóstico', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copiar informe para Claude' })).toBeVisible();
  for (const t of ['Stock vs movimientos', 'Recetas', 'Usuarios']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  // "Revisar de nuevo" vuelve a revisar y avisa
  await page.getByRole('button', { name: 'Revisar de nuevo' }).click();
  await expect(page.getByText(/^Revisión hecha/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar de nuevo' })).toBeEnabled();
  await page.getByText('Ver el informe completo').click();
  await expect(page.getByLabel('Informe de diagnóstico')).toHaveValue(/^# Diagnóstico de Stock Manager v/);
});

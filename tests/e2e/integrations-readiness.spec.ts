import { expect, test } from '@playwright/test';
import { go, loadDemo } from './helpers';

test('integraciones: la preparación para Maxirest revisa códigos y depósitos', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/integraciones');
  const panel = page.getByRole('region', { name: 'Preparación para Maxirest' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('progressbar', { name: 'Productos con código de Maxirest' })).toBeVisible();
  await expect(panel.getByText('Ningún código repetido')).toBeVisible();
  await expect(panel.getByText('Falta comparar con los insumos de Maxirest')).toBeVisible();
});

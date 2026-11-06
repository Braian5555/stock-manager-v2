import { expect, test } from '@playwright/test';
import { enableMaxirest, go, loadDemo } from './helpers';

test('integraciones: la preparación para Maxirest revisa códigos y depósitos', async ({ page }) => {
  await loadDemo(page);
  await enableMaxirest(page);
  const panel = page.getByRole('region', { name: 'Preparación para Maxirest' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('progressbar', { name: 'Productos con código de Maxirest' })).toBeVisible();
  await expect(panel.getByText('Ningún código repetido')).toBeVisible();
  await expect(panel.getByText('Falta comparar con los insumos de Maxirest')).toBeVisible();
});

test('integraciones: conectar Maxirest en tres pasos con el servidor de la IA', async ({ page }) => {
  await loadDemo(page);
  await enableMaxirest(page);
  const card = page.getByRole('region', { name: 'Conectar Maxirest' });
  await expect(card).toBeVisible();
  // Sin la IA configurada, el paso 1 lleva a activarla primero.
  await expect(card.getByRole('listitem', { name: /Paso 1: Servidor de conexión \(pendiente\)/ })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Activar la IA primero' })).toBeVisible();
  await expect(card.getByRole('listitem', { name: /Paso 2: Permiso de Maxirest/ })).toContainText('Primero conectá el servidor');
  await card.getByRole('button', { name: /Revisar y completar|Ver detalle/ }).click();
  await expect(page.getByRole('region', { name: 'Preparación para Maxirest' })).toBeVisible();
});

test('independiente: Maxirest no aparece hasta que se activa la conexión', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/mas');
  await expect(page.locator('main').getByRole('link', { name: /Integraciones/ })).toHaveCount(0);
  await go(page, '/exportar');
  await expect(page.getByRole('heading', { name: /Maxirest/ })).toHaveCount(0);
  await go(page, '/integraciones');
  await expect(page.getByText('Orillas funciona solo.')).toBeVisible();
  await page.getByRole('button', { name: 'Activar la conexión con Maxirest' }).click();
  await expect(page.getByRole('region', { name: 'Conectar Maxirest' })).toBeVisible();
  await page.getByRole('button', { name: 'Dejar de usar Maxirest' }).click();
  await expect(page.getByText('Orillas funciona solo.')).toBeVisible();
});

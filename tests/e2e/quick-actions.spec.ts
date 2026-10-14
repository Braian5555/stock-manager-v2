import { expect, test } from '@playwright/test';
import { go, loadDemo } from './helpers';

test('sin botón + flotante: las acciones rápidas están sólo en Inicio', async ({ page }) => {
  await loadDemo(page);
  for (const path of ['/stock', '/movimientos', '/configuracion']) {
    await go(page, path);
    await expect(page.getByRole('button', { name: 'Acciones rápidas' })).toHaveCount(0);
  }
});

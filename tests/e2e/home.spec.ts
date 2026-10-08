import { expect, test } from '@playwright/test';
import { loadDemo } from './helpers';

test('inicio: en el celular acciones grandes, en la computadora el tablero completo', async ({ page, isMobile }) => {
  await loadDemo(page);
  if (isMobile) {
    await expect(page.getByRole('heading', { name: /^Hola/, level: 1 })).toBeVisible();
    const actions = page.getByRole('navigation', { name: 'Acciones rápidas' });
    for (const a of ['Contar stock', 'Registrar movimiento', 'Recibir pedido', 'Nuevo pedido', 'Nuevo remito', 'Foto de factura', 'Ver stock']) await expect(actions.getByRole('link', { name: a })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Para reponer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bloquear / cambiar usuario' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Buscar producto' })).toBeVisible();
    await actions.getByRole('button', { name: 'Buscar producto' }).click();
    await expect(page.getByRole('dialog', { name: 'Buscar' })).toBeVisible();
    await page.keyboard.press('Escape');
    await actions.getByRole('link', { name: 'Contar stock' }).click();
    await expect(page).toHaveURL(/#\/conteo$/);
  } else {
    await expect(page.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alertas de stock' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Últimos movimientos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pedidos abiertos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Remitos sin cargar en Maxirest' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Acciones rápidas' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Usuario:/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Bloquear / cambiar usuario' })).toBeVisible();
  }
});

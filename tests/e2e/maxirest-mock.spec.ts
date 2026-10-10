import { expect, test, type Page } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

/**
 * Pruebas de la integración usando el MAXIREST SIMULADO.
 * No prueban la API real de Maxirest (no existe una API pública documentada).
 */
async function connectMock(page: Page) {
  await go(page, '/integraciones');
  await page.getByRole('button', { name: 'Configurar' }).click();
  const d = dialog(page);
  await d.getByLabel(/Demostración — Maxirest simulado/).check();
  await d.getByLabel('Sistema principal de stock').selectOption('manual');
  await d.getByRole('button', { name: 'Continuar' }).click(); // 1 → 2 prueba
  await expect(d.getByText(/Conexión simulada correcta/)).toBeVisible();
  await d.getByRole('button', { name: 'Continuar' }).click(); // 3 importar
  await expect(d.getByText('Productos ✓')).toBeVisible();
  await expect(d.getByText('Depósitos ✓')).toBeVisible();
  await d.getByRole('button', { name: 'Continuar' }).click(); // 4 resumen
  await expect(d.locator('.stat', { hasText: 'insumos' }).locator('.stat-value')).toHaveText('12');
  await d.getByRole('button', { name: 'Continuar' }).click(); // 5 mapear (sugerencias por código)
  await expect(d.getByText('Sugerido').first()).toBeVisible();
  await d.getByRole('button', { name: 'Guardar vínculos' }).click();
  await expect(page.getByText(/vínculos actualizados/)).toBeVisible();
  await d.getByRole('button', { name: 'Continuar' }).click(); // 6 confirmar
  await d.getByRole('button', { name: 'Confirmar y sincronizar' }).click(); // 7
  await expect(d.getByText('Stock ✓')).toBeVisible();
  await d.getByRole('button', { name: 'Finalizar' }).click();
}

test('Maxirest simulado: asistente, vínculos sin duplicados, conciliación y ajuste confirmado', async ({ page }) => {
  await loadDemo(page);
  await connectMock(page);
  await expect(page.getByText('Modo demostración — Maxirest simulado').first()).toBeVisible();
  await expect(page.getByText('Conectado')).toBeVisible();
  await expect(page.getByText(/1 insumo de Maxirest no está vinculado/)).toBeVisible();

  // Conciliación: Carne picada local 2 vs Maxirest 4 → -2
  await go(page, '/conciliacion');
  const row = page.locator('tbody tr', { hasText: 'Carne picada' });
  await expect(row).toContainText('-2');
  await expect(row).toContainText('Diferencia negativa');

  // Ajuste sincronizado con confirmación (Stock Manager → Maxirest)
  await row.getByRole('button', { name: 'Ajustar Maxirest' }).click();
  await expect(dialog(page)).toContainText('¿Confirmar ajuste en Maxirest?');
  await dialog(page).getByRole('button', { name: 'Confirmar ajuste' }).click();
  await expect(page.getByText('Maxirest actualizado')).toBeVisible();
  await expect(row).toContainText('Igual');

  // Pedidos: no se ofrece enviar a Maxirest
  await go(page, '/pedidos/nuevo');
  await expect(page.getByText(/No se envían a Maxirest/)).toBeVisible();
});

test('Maxirest simulado: error comprensible, cola, reintento sin duplicar y desconexión segura', async ({ page }) => {
  await loadDemo(page);
  await connectMock(page);
  await page.getByLabel('Simular que Maxirest no responde').check();

  await go(page, '/stock');
  const card = page.getByRole('article', { name: 'Papa' });
  await card.getByRole('button', { name: 'Registrar movimiento' }).click();
  await dialog(page).getByLabel('Tipo de movimiento').selectOption('ajuste');
  await dialog(page).getByLabel('Nueva cantidad en stock').fill('5');
  await dialog(page).getByLabel(/Ajuste sincronizado/).check();
  await dialog(page).getByRole('button', { name: 'Registrar' }).click();
  await dialog(page).getByRole('button', { name: 'Confirmar ajuste' }).click();
  await expect(page.getByText('No fue posible actualizar el stock en Maxirest. Quedó pendiente y podrá reintentarse.').first()).toBeVisible();
  await expect(page.getByText(/503|500 Internal/)).toHaveCount(0);
  await expect(page.getByText('Movimientos pendientes de sincronizar: 1')).toBeVisible();
  await expect(card.locator('.pcard-qty strong')).toHaveText('5'); // el ajuste local sí se aplicó

  await go(page, '/integraciones');
  await page.getByLabel('Simular que Maxirest no responde').uncheck();
  await page.getByRole('button', { name: 'Cola de sincronización' }).click();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('Sincronizado', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Movimientos pendientes de sincronizar')).toHaveCount(0);

  // Desconectar NO borra datos
  await page.getByRole('button', { name: 'Desconectar' }).click();
  await dialog(page).getByRole('button', { name: 'Desconectar' }).click();
  await expect(page.getByText('Desconectado').first()).toBeVisible();
  await go(page, '/productos');
  await expect(page.locator('tbody tr:not(.group-row)')).toHaveCount(15);
  await expect(page.getByText('Maxirest').first()).toBeVisible();
});

test('Excel Bridge: importa un inventario exportado de Maxirest (CSV) y concilia', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/integraciones');
  await page.getByRole('button', { name: 'Excel Bridge' }).click();
  const csv = 'Código;Nombre;Unidad de medida;Costo;Stock actual;Conteo\nHIE-010;Hielo 10 kg;Bolsa;100;6;\nX-99;Insumo sin vincular;Kg;1;3;\n';
  await page.getByLabel('Excel exportado de Maxirest').setInputFiles({ name: 'inventario.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('2 filas válidas')).toBeVisible();
  await page.getByRole('button', { name: 'Importar 2 insumos' }).click();
  await expect(page.getByText(/2 insumos importados desde Excel/)).toBeVisible();
  // Vincular sugeridos (código = SKU)
  await page.getByRole('button', { name: 'Guardar vínculos' }).click();
  await expect(page.getByText('1 vínculo actualizado.')).toBeVisible();
  await go(page, '/conciliacion');
  await expect(page.locator('tbody tr', { hasText: 'Hielo 10 kg' })).toContainText('-3');
  await expect(page.locator('tbody tr', { hasText: 'Insumo sin vincular' })).toContainText('No vinculado');
  await go(page, '/integraciones');
  await page.getByRole('button', { name: 'Excel Bridge' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar stock para Maxirest' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^maxirest_.*\.xlsx$/);
});

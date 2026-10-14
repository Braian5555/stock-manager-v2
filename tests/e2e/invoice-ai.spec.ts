import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialog, go, loadDemo } from './helpers';

// JPEG chico válido (1×1) como "foto" de la factura.
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

test('facturas: leer con IA, revisar renglones y guardar', async ({ page }) => {
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
  await loadDemo(page);
  await go(page, '/nube');
  await page.getByRole('button', { name: 'Entrar con una cuenta de Google' }).click();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  // Lector simulado: responde como Claude, usando las referencias del catálogo que manda la app.
  await page.evaluate(() => {
    type Cat = { ref: string; name: string; unit: string; buy: string };
    (globalThis as unknown as { __smInvoiceReader: (d: unknown) => Promise<unknown> }).__smInvoiceReader = async (data) => {
        const d = data as { images: unknown[]; catalog: Cat[] };
        if (d.images.length !== 1) throw new Error('pedido inválido');
        const ref = (name: string) => d.catalog.find((c) => c.name === name)?.ref ?? null;
        return {
          supplier: { name: 'Distribuidora Ejemplo', cuit: null },
          invoice: { kind: 'factura', number: 'A 0003-00012345', date: '2026-10-10', total: 61000 },
          lines: [
            { description: 'ACEITE GIRASOL 900CC', code: null, quantity: 2, unit: 'caja', unitPrice: 24000, lineTotal: 48000, ref: ref('Aceite de girasol 900 ml'), confidence: 'alta' },
            { description: 'HARINA 000 X KG', code: null, quantity: 25, unit: 'kg', unitPrice: 500, lineTotal: 12500, ref: null, confidence: 'ninguna' },
            { description: 'ENVASES RETORNABLES', code: null, quantity: 1, unit: 'u', unitPrice: 500, lineTotal: 500, ref: null, confidence: 'ninguna' },
          ],
          warnings: ['Descuento general del 5% al pie.'],
        };
    };
  });

  await go(page, '/facturas');
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  const d = dialog(page);
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), 'factura.jpg');
  writeFileSync(file, Buffer.from(JPEG, 'base64'));
  await d.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(d.getByRole('img', { name: 'Hoja 1' })).toBeVisible({ timeout: 20_000 });
  await d.getByRole('button', { name: 'Leer con IA' }).click();
  await expect(page.getByText('Leí 3 renglones: 2 para revisar')).toBeVisible();

  // Completa los datos vacíos y muestra los avisos.
  await expect(d.getByLabel('Proveedor')).toHaveValue('Distribuidora Ejemplo');
  await expect(d.getByLabel(/^Número de factura/)).toHaveValue('A 0003-00012345');
  await expect(d.getByText('Descuento general del 5% al pie.')).toBeVisible();

  const rows = d.getByRole('listitem');
  const aceite = rows.filter({ hasText: 'ACEITE GIRASOL 900CC' });
  await expect(aceite).toContainText('Reconocido');
  await expect(aceite.getByLabel(/^Cantidad en stock de/)).toHaveValue('24'); // 2 cajas × 12
  const harina = rows.filter({ hasText: 'HARINA 000 X KG' });
  await expect(harina).toContainText('Revisar');
  await expect(harina.getByRole('button', { name: /^Producto para/ })).toContainText('Harina 000');
  await harina.getByRole('button', { name: 'Es este' }).click();
  await expect(harina).toContainText('Reconocido');

  // Sin producto: se elige buscando, o se marca que no va al stock.
  const envases = rows.filter({ hasText: 'ENVASES RETORNABLES' });
  await expect(envases).toContainText('Sin producto');
  await envases.getByRole('button', { name: /^Producto para/ }).click();
  await envases.getByLabel(/^Buscar producto para/).fill('sal');
  await envases.getByRole('button', { name: /Sal fina/ }).click();
  await expect(envases).toContainText('Reconocido');
  await envases.getByRole('button', { name: 'No va al stock' }).click();
  await expect(envases).toContainText('No va al stock');

  await d.getByRole('button', { name: 'Guardar factura' }).click();
  await expect(page.getByText('Factura guardada')).toBeVisible();
  const viewer = dialog(page);
  const items = viewer.getByRole('region', { name: 'Productos de la factura' });
  await expect(items).toContainText('Productos (3)');
  await expect(items).toContainText('Revisada');
  await expect(items).toContainText('24 bot');
  await expect(items).toContainText('25 kg');

  // Leer con IA no toca el stock (cargarlo es la etapa 2).
  const stock = await page.evaluate(() => new Promise<number>((res) => {
    const r = indexedDB.open('stock-manager');
    r.onsuccess = () => {
      const q = r.result.transaction('products').objectStore('products').getAll();
      q.onsuccess = () => res((q.result as { name: string; stock: number }[]).find((p) => p.name === 'Aceite de girasol 900 ml')!.stock);
    };
  }));
  expect(stock).toBe(7);
});

test('facturas: lectura con IA por el servidor de Cloudflare (configuración, prueba y lectura)', async ({ page }) => {
  const WORKER = 'https://stock-manager-ia.ejemplo.workers.dev';
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
  let seen: { auth?: string; ws?: string; model?: string; catalog?: boolean } = {};
  await page.route(`${WORKER}/**`, async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, service: 'stock-manager-invoice-reader', configured: true, model: 'claude-sonnet-5-5' }) });
    const body = req.postDataJSON() as { model: string; messages: { content: { type: string; text?: string }[] }[] };
    const text = body.messages[0].content.find((c) => c.type === 'text')!.text!;
    const ref = /^(\w+): Aceite de girasol 900 ml/m.exec(text)?.[1] ?? null;
    seen = { auth: req.headers()['authorization'], ws: req.headers()['x-workspace'], model: body.model, catalog: !!ref };
    const reading = {
      supplier: { name: 'Distribuidora Ejemplo', cuit: null },
      invoice: { kind: 'factura', number: 'B 0001-00000077', date: '2026-10-12', total: 24000 },
      lines: [{ description: 'ACEITE GIRASOL 900CC', code: null, quantity: 1, unit: 'caja', unitPrice: 24000, lineTotal: 24000, ref, confidence: 'alta' }],
      warnings: [],
    };
    return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reading) }] }) });
  });
  await loadDemo(page);
  await go(page, '/nube');
  await page.getByRole('button', { name: 'Entrar con una cuenta de Google' }).click();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  // Configurar la dirección del servidor y probarla.
  await go(page, '/configuracion');
  await page.getByRole('link', { name: /Lectura con IA/ }).first().click();
  await page.getByLabel(/^Dirección del servidor/).fill(`${WORKER}/`);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Conectado. La clave de Anthropic está cargada')).toBeVisible();

  await go(page, '/facturas');
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  const d = dialog(page);
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), 'factura.jpg');
  writeFileSync(file, Buffer.from(JPEG, 'base64'));
  await d.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(d.getByRole('img', { name: 'Hoja 1' })).toBeVisible({ timeout: 20_000 });
  await d.getByRole('button', { name: 'Leer con IA' }).click();
  await expect(page.getByText('Leí 1 renglones, todos reconocidos')).toBeVisible();
  await expect(d.getByRole('listitem').filter({ hasText: 'ACEITE GIRASOL 900CC' }).getByLabel(/^Cantidad en stock de/)).toHaveValue('12');
  expect(seen).toMatchObject({ auth: 'Bearer fake-id-token', model: 'claude-sonnet-5-5', catalog: true });
  expect(seen.ws).toBeTruthy();
});

test('facturas: sin servidor configurado no aparece "Leer con IA"', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/facturas');
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  const d = dialog(page);
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), 'factura.jpg');
  writeFileSync(file, Buffer.from(JPEG, 'base64'));
  await d.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(d.getByRole('img', { name: 'Hoja 1' })).toBeVisible({ timeout: 20_000 });
  await expect(d.getByRole('button', { name: 'Leer con IA' })).toHaveCount(0);
  await expect(d.getByText(/Lectura con IA|leer los productos con IA/)).toHaveCount(0);
});

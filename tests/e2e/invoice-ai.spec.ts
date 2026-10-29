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
  await expect(page.getByText('Conectado con Claude (Anthropic)')).toBeVisible();

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

test('facturas: lectura con Gemini (gratis) por el servidor de Cloudflare', async ({ page }) => {
  const WORKER = 'https://stock-manager-ia.ejemplo.workers.dev';
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
  let posted = '';
  await page.route(`${WORKER}/**`, async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, service: 'stock-manager-invoice-reader', configured: true, provider: 'gemini', model: 'gemini-3.8-flash' }) });
    posted = req.url();
    const body = req.postDataJSON() as { systemInstruction: unknown; contents: { parts: { text?: string }[] }[] };
    const text = body.contents[0].parts.find((p) => p.text)!.text!;
    const ref = /^(\w+): Aceite de girasol 900 ml/m.exec(text)?.[1] ?? null;
    const reading = {
      supplier: { name: 'Distribuidora Ejemplo', cuit: null },
      invoice: { kind: 'factura', number: 'A 0001-00000099', date: '2026-10-16', total: 48000 },
      lines: [{ description: 'ACEITE GIRASOL 900CC', code: null, quantity: 2, unit: 'caja', unitPrice: 24000, lineTotal: 48000, ref, confidence: 'alta' }],
      warnings: [],
    };
    return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(reading) + '\n```' }] }, finishReason: 'STOP' }] }) });
  });
  await loadDemo(page);
  await go(page, '/nube');
  await page.getByRole('button', { name: 'Entrar con una cuenta de Google' }).click();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  await go(page, '/configuracion');
  await page.getByRole('link', { name: /Lectura con IA/ }).first().click();
  await page.getByLabel(/^Dirección del servidor/).fill(WORKER);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Conectado con Gemini (Google)')).toBeVisible();

  await go(page, '/facturas');
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  const d = dialog(page);
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), 'factura.jpg');
  writeFileSync(file, Buffer.from(JPEG, 'base64'));
  await d.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(d.getByRole('img', { name: 'Hoja 1' })).toBeVisible({ timeout: 20_000 });
  await d.getByRole('button', { name: 'Leer con IA' }).click();
  await expect(page.getByText('Leí 1 renglones, todos reconocidos')).toBeVisible();
  expect(posted).toBe(`${WORKER}/gemini`);
  await expect(d.getByRole('listitem').filter({ hasText: 'ACEITE GIRASOL 900CC' }).getByLabel(/^Cantidad en stock de/)).toHaveValue('24');
  await expect(d.getByLabel(/^Número de factura/)).toHaveValue('A 0001-00000099');
});

test('facturas: "Leer factura con IA" lee sola al sacar la foto, y una factura ya cargada se puede leer después', async ({ page }) => {
  const WORKER = 'https://stock-manager-ia.ejemplo.workers.dev';
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
  let reads = 0;
  await page.route(`${WORKER}/**`, async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, service: 'stock-manager-invoice-reader', configured: true, provider: 'gemini', model: 'gemini-3.8-flash' }) });
    reads++;
    const text = (req.postDataJSON() as { contents: { parts: { text?: string }[] }[] }).contents[0].parts.find((p) => p.text)!.text!;
    const ref = /^(\w+): Harina 000/m.exec(text)?.[1] ?? null;
    const reading = { supplier: { name: 'Distribuidora Ejemplo', cuit: null }, invoice: { kind: 'factura', number: `A 0001-0000010${reads}`, date: null, total: 12500 }, lines: [{ description: 'HARINA 000 X KG', code: null, quantity: 25, unit: 'kg', unitPrice: 500, lineTotal: 12500, ref, confidence: 'alta' }], warnings: [] };
    return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reading) }] }, finishReason: 'STOP' }] }) });
  });
  await loadDemo(page);
  await go(page, '/nube');
  await page.getByRole('button', { name: 'Entrar con una cuenta de Google' }).click();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  // Sin servidor configurado no hay botón de IA en Facturas.
  await go(page, '/facturas');
  await expect(page.getByRole('button', { name: 'Leer factura con IA' })).toHaveCount(0);
  // Una factura cargada antes, sin leer.
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), 'factura.jpg');
  writeFileSync(file, Buffer.from(JPEG, 'base64'));
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  await dialog(page).getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(dialog(page).getByRole('img', { name: 'Hoja 1' })).toBeVisible({ timeout: 20_000 });
  await dialog(page).getByRole('button', { name: 'Guardar factura' }).click();
  await expect(page.getByText('Factura guardada')).toBeVisible();
  // Al guardar se cierra la carga y se abre la factura: se espera a que esté abierta antes de cerrarla.
  await expect(page.getByRole('dialog').getByRole('heading', { name: /^Factura/ })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); // que no quede ninguna ventana encima

  await go(page, '/configuracion');
  await page.getByRole('link', { name: /Lectura con IA/ }).first().click();
  await page.getByLabel(/^Dirección del servidor/).fill(WORKER);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Conectado con Gemini (Google)')).toBeVisible();

  // 1) Botón en Facturas: se saca la foto y la IA lee sola, sin tocar nada más.
  await go(page, '/facturas');
  await page.getByRole('button', { name: 'Leer factura con IA' }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Leer factura con IA' })).toBeVisible();
  await d.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(page.getByText('Leí 1 renglones, todos reconocidos')).toBeVisible({ timeout: 20_000 });
  expect(reads).toBe(1);
  await expect(d.getByRole('listitem').filter({ hasText: 'HARINA 000 X KG' })).toContainText('Reconocido');
  await d.getByRole('button', { name: 'Guardar factura' }).click();
  await expect(page.getByText('Factura guardada')).toBeVisible();
  // Al guardar se cierra la carga y se abre la factura: se espera a que esté abierta antes de cerrarla.
  await expect(page.getByRole('dialog').getByRole('heading', { name: /^Factura/ })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); // que no quede ninguna ventana encima

  // 2) La factura cargada antes: al abrirla aparece "Leer con IA" y la lee.
  await page.getByRole('button', { name: /^Factura/ }).filter({ hasNotText: '0001-' }).first().click();
  const v = dialog(page);
  await v.getByRole('button', { name: 'Leer con IA' }).click();
  // (el aviso de la lectura anterior puede seguir en pantalla: se espera la segunda lectura)
  await expect.poll(() => reads, { timeout: 20_000 }).toBe(2);
  await expect(page.getByText('Leí 1 renglones, todos reconocidos').last()).toBeVisible({ timeout: 20_000 });

  // 3) Desde el Inicio, "Foto de factura" ya abre con la IA.
  await dialog(page).getByRole('button', { name: 'Cancelar' }).click();
  await go(page, '/');
  await page.getByRole('navigation', { name: 'Acciones rápidas' }).getByRole('link', { name: /^Foto de factura/ }).click();
  await expect(page).toHaveURL(/#\/facturas\?nueva=1&ia=1$/);
  await expect(dialog(page).getByRole('heading', { name: 'Leer factura con IA' })).toBeVisible();
});

test('facturas: cargar al stock (bultos, producto nuevo, deshacer) y la próxima vez lo reconoce sola', async ({ page }) => {
  await loadDemo(page);
  await page.evaluate(() => {
    type Cat = { ref: string; name: string };
    let reads = 0;
    (globalThis as unknown as { __smInvoiceReader: (d: unknown) => Promise<unknown> }).__smInvoiceReader = async (data) => {
      const d = data as { catalog: Cat[] };
      const ref = (name: string) => d.catalog.find((c) => c.name === name)?.ref ?? null;
      reads++;
      const amargo = { description: 'AMARGO OBRERO X 950 CC', code: null, quantity: reads === 1 ? 1 : 2, unit: 'B', packSize: null, unitPrice: 2400, lineTotal: 2400, ref: null, confidence: 'ninguna' };
      return {
        supplier: { name: 'Distribuidora Ejemplo', cuit: null },
        invoice: { kind: 'factura', number: `B 0001-0000000${reads}`, date: null, total: null },
        lines: reads === 1
          ? [{ description: 'ACEITE GIRASOL 900CC', code: null, quantity: 2, unit: 'caja', unitPrice: 24000, lineTotal: 48000, ref: ref('Aceite de girasol 900 ml'), confidence: 'alta' }, amargo]
          : [amargo],
        warnings: [],
      };
    };
  });
  const stockOf = (name: string) => page.evaluate((n) => new Promise<number | undefined>((res) => {
    const r = indexedDB.open('stock-manager');
    r.onsuccess = () => {
      const q = r.result.transaction('products').objectStore('products').getAll();
      q.onsuccess = () => res((q.result as { name: string; stock: number }[]).find((p) => p.name === n)?.stock);
    };
  }), name);
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), 'factura.jpg');
  writeFileSync(file, Buffer.from(JPEG, 'base64'));

  await go(page, '/facturas');
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  const d = dialog(page);
  await d.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(d.getByRole('img', { name: 'Hoja 1' })).toBeVisible({ timeout: 20_000 });
  await d.getByRole('button', { name: 'Leer con IA' }).click();
  await expect(page.getByText('Leí 2 renglones: 1 para revisar')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Guardar y cargar al stock' })).toHaveCount(0); // falta revisar

  // El amargo no está en el catálogo: se crea ahí mismo, con las 6 unidades que trae el bulto.
  const amargo = d.getByRole('listitem').filter({ hasText: 'AMARGO OBRERO X 950 CC' });
  await expect(amargo).toContainText('Sin producto');
  await amargo.getByRole('button', { name: 'Crear producto' }).click();
  const form = amargo.getByRole('group', { name: /^Nuevo producto/ });
  await expect(form.getByLabel('Nombre')).toHaveValue('Amargo Obrero x 950 cc');
  await form.getByLabel(/^Cada bulto trae/).fill('6');
  await form.getByRole('button', { name: 'Crear y usar' }).click();
  await expect(page.getByText('Producto creado')).toBeVisible();
  await expect(amargo).toContainText('Reconocido');
  await expect(amargo.getByLabel(/^Cantidad en stock de/)).toHaveValue('6');

  await d.getByRole('button', { name: 'Guardar y cargar al stock' }).click();
  await expect(page.getByText('Factura guardada y cargada al stock (2 productos)')).toBeVisible();
  const v = dialog(page);
  await expect(v.getByText('Cargada al stock')).toBeVisible();
  expect(await stockOf('Aceite de girasol 900 ml')).toBe(31); // 7 + 2 cajas × 12
  expect(await stockOf('Amargo Obrero x 950 cc')).toBe(6);

  // Deshacer y volver a cargar: nunca suma dos veces.
  await v.getByRole('button', { name: 'Deshacer carga' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Deshacer carga' }).click();
  await expect(page.getByText('Carga deshecha')).toBeVisible();
  expect(await stockOf('Aceite de girasol 900 ml')).toBe(7);
  expect(await stockOf('Amargo Obrero x 950 cc')).toBe(0);
  await v.getByRole('button', { name: 'Cargar al stock' }).click();
  await expect(page.getByText('Cargado al stock: 2 productos')).toBeVisible();
  expect(await stockOf('Aceite de girasol 900 ml')).toBe(31);
  await expect(v.getByRole('button', { name: 'Cargar al stock' })).toHaveCount(0);
  await v.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByRole('button', { name: /^Factura/ }).first()).toContainText('En stock');

  // Otra factura con el mismo amargo: ya lo reconoce y sabe que el bulto trae 6.
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  await d.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(d.getByRole('img', { name: 'Hoja 1' })).toBeVisible({ timeout: 20_000 });
  await d.getByRole('button', { name: 'Leer con IA' }).click();
  await expect(page.getByText('Leí 1 renglones, todos reconocidos')).toBeVisible();
  await expect(d.getByRole('listitem').filter({ hasText: 'AMARGO OBRERO X 950 CC' }).getByLabel(/^Cantidad en stock de/)).toHaveValue('12');
  await d.getByRole('button', { name: 'Guardar y cargar al stock' }).click();
  await expect(page.getByText('Factura guardada y cargada al stock (1 producto)')).toBeVisible();
  expect(await stockOf('Amargo Obrero x 950 cc')).toBe(18);
});

import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialog, go, loadDemo } from './helpers';

const WORKER = 'https://stock-manager-ia.ejemplo.workers.dev';
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

type Part = { text?: string; inlineData?: unknown; functionCall?: { name: string }; functionResponse?: { name: string; response: Record<string, unknown> } };
type Req = { systemInstruction: { parts: { text: string }[] }; contents: { role: string; parts: Part[] }[]; tools: { functionDeclarations: { name: string }[] }[] };
const reply = (parts: unknown[]) => JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] });

/** Gemini simulado: responde según el último mensaje, como lo haría la IA de verdad. */
async function fakeGemini(page: Page, log: Req[]) {
  await page.route(`${WORKER}/**`, async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, service: 'stock-manager-invoice-reader', configured: true, provider: 'gemini', model: 'gemini-3.8-flash' }) });
    expect(req.headers().authorization).toBe('Bearer fake-id-token');
    const body = req.postDataJSON() as Req;
    log.push(body);
    const last = body.contents[body.contents.length - 1];
    const text = last.parts.find((p) => p.text)?.text ?? '';
    const resp = last.parts.find((p) => p.functionResponse)?.functionResponse;
    // Simula a Gemini saturado la primera vez que se pregunta "probá saturado".
    if (/probá saturado/.test(text) && !log.some((x, i) => i < log.length - 1 && JSON.stringify(x.contents).includes('probá saturado'))) {
      return r.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded. Please try again later.' } }) });
    }
    const ref = (name: string) => new RegExp(`^(p\\d+)\\|${name}\\|`, 'm').exec(body.systemInstruction.parts[0].text)?.[1];
    let parts: unknown[];
    if (resp?.name === 'reponer') {
      const grupos = (resp.response.resultado as { grupos: { grupo: string; productos: { nombre: string; pedir: string }[] }[] }).grupos;
      parts = [{ text: `Para reponer:\n${grupos.flatMap((g) => g.productos.map((x) => `- **${x.nombre}**: pedir ${x.pedir}`)).join('\n')}` }];
    } else if (resp?.name === 'cargar_factura') {
      parts = [{ text: resp.response.error ? `No se pudo: ${resp.response.error}` : 'Listo: la factura quedó en Facturas y en el stock.' }];
    } else if (resp?.name === 'registrar_movimientos') {
      parts = [{ text: resp.response.error ? `No se pudo: ${resp.response.error}` : 'Listo, cargué el remito.' }];
    } else if (/reponer/i.test(text)) {
      parts = [{ functionCall: { name: 'reponer', args: {} }, thoughtSignature: 'sig-1' }];
    } else if (/factura/i.test(text) && last.parts.some((p) => p.inlineData)) {
      parts = [{ functionCall: { name: 'cargar_factura', args: { proveedor: 'Distribuidora Ejemplo', numero: 'B 0001-00000077', fecha: '2026-10-17', total: 48000, tipo: 'factura', renglones: [{ descripcion: 'ACEITE GIRASOL 900CC', producto: ref('Aceite de girasol 900 ml'), cantidad: 2, unidad: 'caja', precio_unitario: 24000, total_renglon: 48000 }] } }, thoughtSignature: 'sig-3' }];
    } else if (/remito/i.test(text) && last.parts.some((p) => p.inlineData)) {
      parts = [{ text: 'Leí el remito: 2 cajas de aceite.' }, { functionCall: { name: 'registrar_movimientos', args: { referencia: 'Remito 0001-77', movimientos: [{ producto: ref('Aceite de girasol 900 ml'), tipo: 'ingreso', cantidad: 2, unidad: 'compra' }] } }, thoughtSignature: 'sig-2' }];
    } else {
      parts = [{ text: 'Hola, ¿en qué te ayudo?' }];
    }
    return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: reply(parts) });
  });
}

async function setup(page: Page) {
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
  await loadDemo(page);
  // Sin IA configurada no aparece el asistente.
  await expect(page.getByRole('link', { name: 'Asistente IA' })).toHaveCount(0);
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
}

const stockOf = (page: Page, name: string) => page.evaluate((n) => new Promise<number | undefined>((res) => {
  const r = indexedDB.open('stock-manager');
  r.onsuccess = () => {
    const q = r.result.transaction('products').objectStore('products').getAll();
    q.onsuccess = () => res((q.result as { name: string; stock: number }[]).find((p) => p.name === n)?.stock);
  };
}), name);

test('asistente: consulta, foto de remito con confirmación y conversación que sigue al cambiar de pantalla', async ({ page }) => {
  const log: Req[] = [];
  await fakeGemini(page, log);
  await setup(page);

  // Se abre desde el encabezado (y también está en el Inicio).
  await go(page, '/');
  await expect(page.getByRole('navigation', { name: 'Acciones rápidas' }).getByRole('link', { name: /Asistente IA/ })).toBeVisible();
  await page.getByRole('link', { name: 'Asistente IA' }).first().click();
  await expect(page).toHaveURL(/#\/asistente$/);
  await expect(page.getByRole('heading', { name: 'Asistente' })).toBeVisible();

  // 1) Consulta con una idea sugerida: usa datos reales (sugerencia de pedido).
  await page.getByRole('button', { name: '¿Qué tengo que reponer?' }).click();
  const thread = page.getByRole('log', { name: 'Conversación con el asistente' });
  await expect(thread.getByText('Para reponer:')).toBeVisible();
  await expect(thread).toContainText('Armó la sugerencia de pedido');
  await expect(thread.getByRole('link', { name: 'Abrir Stock · Para reponer' })).toBeVisible();
  expect(log[0].tools[0].functionDeclarations.map((d) => d.name)).toContain('registrar_movimientos'); // admin: todo
  expect(log[1].contents[1].parts[0]).toMatchObject({ thoughtSignature: 'sig-1' });

  // 2) Foto de un remito: propone el ingreso y no toca nada hasta confirmar.
  const before = await stockOf(page, 'Aceite de girasol 900 ml');
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), 'remito.jpg');
  writeFileSync(file, Buffer.from(JPEG, 'base64'));
  await page.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Mensaje para el asistente').fill('Cargá este remito');
  await page.getByRole('button', { name: 'Enviar' }).click();
  const card = thread.getByRole('region', { name: 'Cambios para confirmar' });
  await expect(card).toContainText('Registrar 1 movimiento');
  await expect(card).toContainText(`Ingreso +24 bot · Aceite de girasol 900 ml (${before} → ${before! + 24})`);
  expect(await stockOf(page, 'Aceite de girasol 900 ml')).toBe(before);
  await card.getByRole('button', { name: 'Confirmar' }).click();
  await expect(thread.getByText('Listo, cargué el remito.')).toBeVisible();
  await expect(card).toContainText('Hecho');
  expect(await stockOf(page, 'Aceite de girasol 900 ml')).toBe(before! + 24);
  await expect(card.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
  // Si la IA se equivocó, se deshace ahí mismo.
  await card.getByRole('button', { name: 'Deshacer' }).click();
  await expect(card).toContainText('Deshecho: el stock volvió a como estaba');
  expect(await stockOf(page, 'Aceite de girasol 900 ml')).toBe(before);

  // Queda en el historial como hecho por el asistente.
  await go(page, '/movimientos');
  await expect(page.getByText('Remito 0001-77').locator('visible=true').first()).toBeVisible();

  // 3) Volver: la conversación sigue ahí.
  await page.getByRole('link', { name: 'Asistente IA' }).first().click();
  await expect(thread.getByText('Listo, cargué el remito.')).toBeVisible();
  // Queda guardada en el dispositivo (la nube de prueba no conserva la sesión al recargar).
  await expect.poll(() => page.evaluate(() => new Promise<string>((res) => {
    const r = indexedDB.open('stock-manager');
    r.onsuccess = () => {
      const q = r.result.transaction('meta').objectStore('meta').getAll();
      q.onsuccess = () => res(JSON.stringify((q.result as { key: string; value: unknown }[]).filter((m) => m.key.startsWith('assistant.current:'))));
    };
  }))).toContain('Listo, cargué el remito.');

  // 4) Nueva conversación: la anterior queda en el historial y se puede retomar.
  await page.getByRole('button', { name: 'Nueva conversación' }).click();
  await expect(thread.getByText('Listo, cargué el remito.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Historial' }).click();
  await dialog(page).getByRole('button', { name: /^¿Qué tengo que reponer\?/ }).click();
  await expect(dialog(page)).toContainText('Cargá este remito');
  await dialog(page).getByRole('button', { name: 'Seguir esta conversación' }).click();
  await expect(thread.getByText('Listo, cargué el remito.')).toBeVisible();
  // Lo que se hizo y se deshizo queda así (no se puede deshacer de nuevo después de retomarla).
  await expect(thread.getByRole('button', { name: 'Deshacer' })).toHaveCount(0);
});

test('asistente: cancelar un cambio no toca el stock', async ({ page }) => {
  const log: Req[] = [];
  await fakeGemini(page, log);
  await setup(page);
  await go(page, '/asistente');
  const before = await stockOf(page, 'Aceite de girasol 900 ml');
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), 'remito.jpg');
  writeFileSync(file, Buffer.from(JPEG, 'base64'));
  await page.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Mensaje para el asistente').fill('Cargá este remito');
  await page.getByRole('button', { name: 'Enviar' }).click();
  const card = page.getByRole('region', { name: 'Cambios para confirmar' });
  await card.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByText('Listo, no hice ningún cambio.')).toBeVisible();
  await expect(card).toContainText('Cancelado');
  expect(await stockOf(page, 'Aceite de girasol 900 ml')).toBe(before);
  expect(log).toHaveLength(1); // cancelar no gasta otra consulta
});

test('asistente: la foto de una factura queda guardada en Facturas y cargada al stock', async ({ page }) => {
  const log: Req[] = [];
  await fakeGemini(page, log);
  await setup(page);
  await go(page, '/asistente');
  const before = await stockOf(page, 'Aceite de girasol 900 ml');
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), 'factura.jpg');
  writeFileSync(file, Buffer.from(JPEG, 'base64'));
  await page.getByLabel('Fotos desde la galería').setInputFiles(file);
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Mensaje para el asistente').fill('Guardá esta factura');
  await page.getByRole('button', { name: 'Enviar' }).click();
  const card = page.getByRole('region', { name: 'Cambios para confirmar' });
  await expect(card).toContainText('Guardar la factura y cargarla al stock');
  await expect(card).toContainText('+24 bot · Aceite de girasol 900 ml (2 caja)');
  await card.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Listo: la factura quedó en Facturas y en el stock.')).toBeVisible();
  await expect(card).toContainText('Guardada en Facturas y cargada al stock (1 producto)');
  expect(await stockOf(page, 'Aceite de girasol 900 ml')).toBe(before! + 24);

  // En Facturas, con la foto, como cargada.
  await go(page, '/facturas');
  const row = page.getByRole('button', { name: /^Factura B 0001-00000077 de Distribuidora Ejemplo/ });
  await expect(row).toContainText('En stock');
  await row.click();
  const v = dialog(page);
  await expect(v.getByText('Cargada al stock')).toBeVisible();
  await expect(v.getByRole('region', { name: 'Productos de la factura' })).toContainText('24 bot');
  await expect(v.getByRole('img', { name: 'Factura, hoja 1' })).toBeVisible({ timeout: 20_000 });
});

test('asistente: si Gemini está saturado, reintenta solo', async ({ page }) => {
  const log: Req[] = [];
  await fakeGemini(page, log);
  await setup(page);
  await go(page, '/asistente');
  await page.getByLabel('Mensaje para el asistente').fill('hola, probá saturado');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Hola, ¿en qué te ayudo?')).toBeVisible({ timeout: 15_000 });
  expect(log).toHaveLength(2); // el primero falló (503) y se reintentó
  await expect(page.getByText(/Gemini está saturado/)).toHaveCount(0);
});

test('asistente: en el celular Enter baja de renglón y en la computadora manda', async ({ page }, info) => {
  const log: Req[] = [];
  await fakeGemini(page, log);
  await setup(page);
  await go(page, '/asistente');
  const box = page.getByLabel('Mensaje para el asistente');
  await box.fill('Mandá 2 cocas');
  await box.press('Enter');
  if (info.project.name === 'mobile') {
    await expect(box).toHaveAttribute('enterkeyhint', 'enter');
    await box.pressSequentially('y 3 fernet');
    await expect(box).toHaveValue('Mandá 2 cocas\ny 3 fernet');
    expect(log).toHaveLength(0);
  } else {
    await expect(box).toHaveValue('');
    await expect.poll(() => log.length).toBe(1);
  }
});

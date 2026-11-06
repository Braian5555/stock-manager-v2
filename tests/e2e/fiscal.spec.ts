import { expect, test, type Page } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

const SERVICE = 'https://arca-test.example.workers.dev';

/** Servicio de ARCA simulado (el Worker real se prueba en las pruebas unitarias contra una ARCA simulada). */
async function fakeService(page: Page) {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  let last = 41;
  await page.route(`${SERVICE}/**`, async (route) => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname;
    const body = req.postDataJSON() as Record<string, unknown>;
    seen.push({ path, body });
    const json = (data: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (path === '/last') return json({ nro: last, log: [{ op: 'WSFE.FECompUltimoAutorizado', at: new Date().toISOString(), ms: 120 }] });
    if (path === '/emit') {
      const d = body.doc as { nro: number; fecha: string };
      if (d.nro !== last + 1) return json({ status: 'renumerar', next: last + 1, log: [] });
      last = d.nro;
      return json({ status: 'autorizada', nro: d.nro, cae: '76012345678901', caeVto: '20991231', fecha: d.fecha, obs: [], by: 'Admin', log: [{ op: 'WSFE.FECAESolicitar', at: new Date().toISOString(), ms: 640, request: '<ar:Token>***</ar:Token>', response: '<Resultado>A</Resultado>' }] });
    }
    if (path === '/status') return json({ cuit: '30712345671', kv: true, prodEnabled: false, homologacion: { cert: true, cn: 'stockmanager', cuit: '30712345671', vence: '2028-01-01T00:00:00Z', key: true }, produccion: { cert: false }, servidores: { app: 'OK', db: 'OK', auth: 'OK' }, autenticacion: 'ok', puntosDeVenta: [], ultimoFB: last, log: [] });
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  return seen;
}

test('facturación electrónica: configurar, cobrar la mesa y emitir Factura B con CAE', async ({ page }) => {
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
  const seen = await fakeService(page);
  await loadDemo(page);
  await go(page, '/nube');
  await page.getByRole('button', { name: 'Entrar con una cuenta de Google' }).click();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  // Configuración fiscal
  await go(page, '/salon/configuracion');
  await expect(page.getByRole('heading', { name: 'Configuración fiscal', level: 1 })).toBeVisible();
  await page.getByLabel('Facturar desde Stock Manager al cobrar las mesas').check();
  await page.getByLabel('Dirección del servicio de ARCA').fill(SERVICE);
  await page.getByLabel('CUIT').fill('30-71234567-1');
  await page.getByLabel('Razón social').fill('Epicurae SA');
  await page.getByLabel('Domicilio fiscal').fill('Av. Siempre Viva 123, CABA');
  await page.getByLabel('Punto de venta').fill('5');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Configuración fiscal guardada')).toBeVisible();
  await page.getByRole('button', { name: 'Probar conexión con ARCA' }).click();
  await expect(page.getByText('Autenticación con ARCA (WSAA) correcta')).toBeVisible();
  await expect(page.getByText('El certificado es del CUIT 30-71234567-1')).toBeVisible();

  // Salón: una mesa con un pedido
  await go(page, '/salon');
  await page.getByLabel('Cantidad de mesas').fill('4');
  await page.getByRole('button', { name: 'Crear mesas' }).click();
  await go(page, '/salon?vista=carta');
  await page.getByRole('button', { name: 'Agregar el primero' }).click();
  let m = dialog(page);
  await m.getByLabel('Nombre').fill('Desayuno americano');
  await m.getByLabel('Sección').fill('Desayunos');
  await m.getByLabel('Precio', { exact: true }).fill('9500');
  await m.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Agregado a la carta')).toBeVisible();
  await go(page, '/salon');
  await page.getByRole('button', { name: 'Mesa 2: Libre' }).click();
  m = dialog(page);
  await m.getByRole('button', { name: 'Agregar Desayuno americano' }).click();
  await m.getByRole('button', { name: 'Agregar Desayuno americano' }).click();
  if (!(await m.getByRole('region', { name: 'Pedido' }).isVisible())) await m.getByRole('group', { name: 'Ver' }).getByRole('button', { name: /^Pedido/ }).click();
  await m.getByRole('button', { name: /^Mandar a cocina/ }).click();
  await m.getByRole('button', { name: 'Pidió la cuenta' }).click();
  await m.getByRole('button', { name: 'Cobrar', exact: true }).first().click();

  // Cobro con factura
  m = page.getByRole('dialog', { name: 'Cobrar · Mesa 2' });
  await expect(m).toBeVisible();
  await m.getByLabel('Efectivo recibido').fill('20000');
  await expect(m.getByText('Vuelto: $ 1.000,00').or(m.getByText(/Vuelto: \$\s?1\.000,00/))).toBeVisible();
  await expect(m.getByText(/Se emite Factura B de PRUEBA/)).toBeVisible();
  await m.getByRole('button', { name: 'Cobrar y emitir Factura B' }).click();
  const done = page.getByRole('dialog', { name: 'Mesa 2' });
  await expect(done.getByText('Factura B 00005-00000042 autorizada')).toBeVisible();
  await expect(done.getByText(/CAE 76012345678901/)).toBeVisible();
  await expect(done.getByRole('button', { name: 'Imprimir ticket' })).toBeVisible();
  await done.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByRole('button', { name: 'Mesa 2: Libre' })).toBeVisible();

  // Lo que se mandó al servicio: número anotado antes, importes y consumidor final.
  const emitBody = seen.find((s) => s.path === '/emit')!.body as { ambiente: string; doc: Record<string, unknown> };
  expect(emitBody.ambiente).toBe('homologacion');
  expect(emitBody.doc).toMatchObject({ ptoVta: 5, cbteTipo: 6, nro: 42, docTipo: 99, condicionIvaReceptor: 5, impTotal: 19000, impNeto: 15702.48, impIva: 3297.52 });

  // Hoy y Comprobantes
  await go(page, '/salon?vista=hoy');
  await expect(page.getByText('Factura B 00005-00000042')).toBeVisible();
  await expect(page.getByText(/Cobrado:.*Efectivo/)).toBeVisible();
  await go(page, '/comprobantes');
  await expect(page.getByRole('heading', { name: 'Comprobantes', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Factura B 00005-00000042/ }).click();
  m = page.getByRole('dialog', { name: 'Factura B 00005-00000042' });
  await expect(m.getByText('76012345678901 (vence 31/12/2099)')).toBeVisible();
  await expect(m.getByText('Registro de ARCA (2)')).toBeVisible();
  await expect(m.getByRole('button', { name: 'Nota de crédito' })).toBeVisible();
});

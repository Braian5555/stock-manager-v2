import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialog, go, loadDemo } from './helpers';

type FakeStore = {
  workspaces: Map<string, { id: string }>;
  coll: (p: string) => Map<string, Record<string, unknown>>;
};

/** Genera una "foto" grande y con ruido (difícil de comprimir) en un archivo temporal. */
async function makePhoto(page: Page, name: string, w = 2400, h = 3200): Promise<string> {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const data = ctx.createImageData(w, h);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      data.data[i] = v; data.data[i + 1] = (v * 7) & 255; data.data[i + 2] = (v * 13) & 255; data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    ctx.fillStyle = '#000';
    ctx.font = '120px sans-serif';
    ctx.fillText('FACTURA A', 100, 200);
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  }, [w, h]);
  const file = join(mkdtempSync(join(tmpdir(), 'sm-')), name);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

const fake = (page: Page) =>
  page.evaluate(() => {
    const s = (globalThis as unknown as { __smFakeCloud: FakeStore }).__smFakeCloud;
    const wsId = [...s.workspaces.keys()][0];
    const imgs = [...s.coll(`${wsId}/invoiceImages`).values()];
    const invs = [...s.coll(`${wsId}/invoices`).values()];
    return { images: imgs.map((i) => String(i.data).length), invoices: invs.map((i) => JSON.stringify(i).length) };
  });

test('facturas: sacar fotos, guardar, ver, descargar y bajarlas de la nube en otro dispositivo', async ({ page }) => {
  await page.route('**/firebase-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'fake' }) }));
  await loadDemo(page);
  await go(page, '/nube');
  await page.getByRole('button', { name: 'Entrar con una cuenta de Google' }).click();
  await page.getByRole('button', { name: 'Crear y subir mis datos' }).click();
  await dialog(page).getByRole('button', { name: 'Crear y subir datos' }).click();
  await expect(page.getByText('Sincronizado').first()).toBeVisible();

  await go(page, '/facturas');
  await expect(page.getByText('Todavía no cargaste facturas')).toBeVisible();
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  const d = dialog(page);
  const p1 = await makePhoto(page, 'hoja1.jpg');
  const p2 = await makePhoto(page, 'hoja2.jpg', 1200, 1600);
  await d.getByLabel('Fotos desde la galería').setInputFiles([p1, p2]);
  await expect(d.getByRole('img', { name: 'Hoja 2' })).toBeVisible({ timeout: 20_000 });
  await d.getByLabel('Proveedor').selectOption({ index: 1 });
  const supplier = (await d.getByLabel('Proveedor').locator('option:checked').textContent())!.trim();
  await d.getByLabel(/^Número de factura/).fill('A 0001-00001234');
  await d.getByLabel(/^Total/).fill('15430.5');
  await d.getByRole('button', { name: 'Guardar factura' }).click();
  await expect(page.getByText('Factura guardada')).toBeVisible();

  // Se abre la factura con sus fotos.
  const viewer = dialog(page);
  await expect(viewer.getByRole('heading', { name: 'Factura A 0001-00001234' })).toBeVisible();
  await expect(viewer.getByRole('img', { name: 'Factura, hoja 1' })).toBeVisible();
  const download = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Descargar hoja 1' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^factura_.+_\d{4}-\d{2}-\d{2}_A_0001-00001234_p1\.jpg$/);
  const bytes = readFileSync((await file.path())!);
  expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff'); // es un JPEG
  expect(bytes.length).toBeLessThan(700_000); // comprimida

  // En la nube: 2 fotos (cada una entra en un documento de Firestore) y la factura sin las fotos.
  await expect.poll(async () => (await fake(page)).images.length).toBe(2);
  const remote = await fake(page);
  for (const len of remote.images) expect(len).toBeLessThan(950_000);
  expect(remote.invoices[0]).toBeLessThan(60_000);

  // Listado, búsqueda y total.
  await viewer.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`Factura A 0001-00001234 de ${supplier}`) })).toBeVisible();
  await expect(page.getByText(/Total cargado: \$\s?15\.430,50/)).toBeVisible();
  await page.getByLabel('Buscar facturas').fill('9999');
  await expect(page.getByText('No hay facturas con esos filtros')).toBeVisible();
  await page.getByLabel('Buscar facturas').fill('1234');

  // "Otro dispositivo": no tiene las fotos guardadas → las baja de la nube al abrir.
  await page.evaluate(() => new Promise<void>((res, rej) => {
    const r = indexedDB.open('stock-manager');
    r.onsuccess = () => {
      const tx = r.result.transaction('invoiceImages', 'readwrite');
      tx.objectStore('invoiceImages').clear();
      tx.oncomplete = () => { r.result.close(); res(); };
      tx.onerror = () => rej(tx.error);
    };
  }));
  await page.getByRole('button', { name: /Factura A 0001-00001234/ }).click();
  await expect(dialog(page).getByRole('img', { name: 'Factura, hoja 2' })).toBeVisible();

  // Editar: quitar una hoja borra su foto también en la nube.
  await dialog(page).getByRole('button', { name: 'Editar datos' }).click();
  await dialog(page).getByRole('button', { name: 'Quitar hoja 2' }).click();
  await dialog(page).getByRole('button', { name: 'Guardar factura' }).click();
  await expect(page.getByText('Factura actualizada')).toBeVisible();
  await expect.poll(async () => (await fake(page)).images.length).toBe(1);
});

test('facturas: se adjuntan desde un pedido', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/pedidos/nuevo');
  await page.getByLabel('Proveedor').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Agregar producto' }).click();
  await page.getByLabel('Producto', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Guardar como pendiente' }).click();
  await expect(page.getByRole('heading', { name: /Pedido #\d+/ })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar factura' }).click();
  const d = dialog(page);
  await d.getByLabel('Foto desde la cámara').setInputFiles(await makePhoto(page, 'f.jpg', 800, 1000));
  await expect(d.getByRole('img', { name: 'Hoja 1' })).toBeVisible({ timeout: 20_000 });
  await expect(d.getByLabel(/^Pedido/).locator('option:checked')).toHaveText(/Pedido #\d+/);
  await d.getByRole('button', { name: 'Guardar factura' }).click();
  await expect(page.getByText('Factura guardada')).toBeVisible();
  await expect(page.locator('.invoice-item')).toHaveCount(1);
  await go(page, '/facturas');
  await expect(page.locator('.invoice-item')).toHaveCount(1);
});

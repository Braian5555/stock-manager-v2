import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { deleteInvoice, getInvoiceImage, invoiceFileName, saveInvoice, type PageDraft } from '../../src/services/invoiceService';
import type { CompressedImage } from '../../src/services/imageService';
import { base64Bytes } from '../../src/services/imageService';
import { effectivePermissions } from '../../src/services/userService';
import { normalizeSettings, defaultMenu } from '../../src/services/settingsService';
import { safeFilename } from '../../src/exports/download';
import { createBackup } from '../../src/services/backupService';
import { FakeBackend, FakeCloudStore } from '../../src/cloud/fakeBackend';
import { SyncEngine } from '../../src/cloud/syncEngine';

const img = (data = 'QUJDRA=='): CompressedImage => ({ data, type: 'image/jpeg', width: 10, height: 20, bytes: base64Bytes(data), thumb: 'data:image/jpeg;base64,AA==' });
const page = (id: string, data?: string): PageDraft => ({ id, image: img(data) });
let engine: SyncEngine | undefined;
afterEach(() => {
  engine?.stop();
  engine = undefined;
});

describe('facturas', () => {
  it('exige al menos una foto y una fecha válida', async () => {
    await expect(saveInvoice({ date: '2026-10-07', pages: [] })).rejects.toThrow(/foto/);
    await expect(saveInvoice({ date: '', pages: [page('p1')] })).rejects.toThrow(/fecha/);
    await expect(saveInvoice({ date: '2026-10-07', total: -1, pages: [page('p1')] })).rejects.toThrow(/total/);
  });

  it('guarda datos y fotos por separado, y al quitar una hoja borra su foto', async () => {
    const inv = await saveInvoice({ date: '2026-10-07', number: ' A-0001 ', total: 1500.5, pages: [page('p1'), page('p2', 'RUZHSA==')] });
    expect(inv.number).toBe('A-0001');
    expect(inv.pages.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(inv.pages[0].thumb).toMatch(/^data:image\/jpeg/);
    expect(JSON.stringify(inv)).not.toContain('QUJDRA=='); // la foto no va en el registro sincronizado
    expect(await db.invoiceImages.count()).toBe(2);
    expect((await db.invoiceImages.get('p1'))?.uploaded).toBe(0);

    const again = await saveInvoice({ id: inv.id, date: inv.date, pages: [{ id: 'p2', existing: inv.pages[1] }] });
    expect(again.pages.map((p) => p.id)).toEqual(['p2']);
    expect(again.createdAt).toBe(inv.createdAt);
    expect(await db.invoiceImages.get('p1')).toBeUndefined();
    expect((await getInvoiceImage('p2', inv.id)).data).toBe('RUZHSA==');
  });

  it('eliminar la factura borra también sus fotos', async () => {
    const inv = await saveInvoice({ date: '2026-10-07', pages: [page('a'), page('b')] });
    await deleteInvoice(inv.id);
    expect(await db.invoices.get(inv.id)).toBeUndefined();
    expect(await db.invoiceImages.count()).toBe(0);
  });

  it('sin nube, una foto que no está en el dispositivo da un mensaje claro', async () => {
    await expect(getInvoiceImage('nope', 'x')).rejects.toThrow(/no está disponible/);
  });

  it('el backup incluye las facturas pero no las fotos', async () => {
    await saveInvoice({ date: '2026-10-07', pages: [page('a', 'Rk9UTw==')] });
    const b = JSON.stringify(await createBackup());
    expect(b).toContain('"invoices"');
    expect(b).not.toContain('Rk9UTw==');
  });

  it('nombre de archivo para descargar', () => {
    const inv = { date: '2026-10-07', number: 'A 0001-0005', pages: [{ id: '1', width: 1, height: 1, bytes: 1 }] };
    expect(invoiceFileName(inv, 'Distribuidora Ñandú', 0, safeFilename)).toBe('factura_Distribuidora_Nandu_2026-10-07_A_0001-0005.jpg');
    expect(invoiceFileName({ ...inv, number: undefined, pages: [...inv.pages, ...inv.pages] }, '', 1, safeFilename)).toBe('factura_2026-10-07_p2.jpg');
  });

  it('si otro dispositivo elimina la factura, se borran las fotos guardadas acá', async () => {
    const store = new FakeCloudStore();
    const backend = new FakeBackend(store);
    const user = await backend.signIn();
    const ws = await backend.createWorkspace(user, 'T');
    const inv = await saveInvoice({ date: '2026-10-07', pages: [page('z')] });
    engine = new SyncEngine(backend, ws.id);
    await engine.start({ pushAll: true });
    await new Promise((r) => setTimeout(r, 30));
    await store.write(`${ws.id}/invoices`, { id: inv.id, _deleted: true, updatedAt: '2999-01-01T00:00:00.000Z' });
    await new Promise((r) => setTimeout(r, 30));
    expect(await db.invoices.get(inv.id)).toBeUndefined();
    expect(await db.invoiceImages.get('z')).toBeUndefined();
  });
});

describe('permisos y menú en versiones nuevas', () => {
  it('usuarios guardados antes reciben el permiso nuevo de su rol', () => {
    expect(effectivePermissions({ role: 'staff', permissions: ['stock.view', 'count.do', 'orders.receive'] })).toContain('invoices');
    expect(effectivePermissions({ role: 'admin', permissions: ['admin'] })).toContain('invoices');
    expect(effectivePermissions({ role: 'custom', permissions: ['count.do'] })).toEqual(['count.do']);
    expect(effectivePermissions({ role: 'custom', permissions: ['admin'] })).toContain('invoices');
  });

  it('un módulo nuevo aparece en su lugar del menú, no al final', () => {
    const old = defaultMenu().filter((m) => m.key !== 'invoices');
    const keys = normalizeSettings({ menu: old }).menu.map((m) => m.key);
    expect(keys.indexOf('invoices')).toBe(keys.indexOf('orders') + 1);
  });
});

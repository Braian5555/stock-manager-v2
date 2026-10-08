import { afterEach, describe, expect, it } from 'vitest';
import { CLOUD_LINK_KEY, db } from '../../src/database/db';
import { FakeBackend, FakeCloudStore } from '../../src/cloud/fakeBackend';
import { SyncEngine } from '../../src/cloud/syncEngine';
import { emptyProduct, saveProduct, deleteProduct } from '../../src/services/productService';
import { applyMovement } from '../../src/services/stockService';
import { createBackup, restoreBackup } from '../../src/services/backupService';
import { saveUser } from '../../src/services/userService';
import { createTransfer, saveOutlet } from '../../src/services/transferService';
import { ensureBaseData } from '../../src/services/seedService';
import { localYmd, parseNumber } from '../../src/utils/format';
import { planProductImport } from '../../src/importers/productImport';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
let engine: SyncEngine | undefined;
afterEach(() => {
  engine?.stop();
  engine = undefined;
});

async function cloud() {
  const store = new FakeCloudStore();
  const backend = new FakeBackend(store);
  const user = await backend.signIn();
  const ws = await backend.createWorkspace(user, 'T');
  const start = async () => {
    engine = new SyncEngine(backend, ws.id);
    await engine.start();
    await tick();
  };
  return { store, ws, start, remote: (t: string) => store.coll(`${ws.id}/${t}`) };
}

describe('sincronización: lo borrado no revive', () => {
  it('una eliminación hecha con la nube apagada se envía al conectar', async () => {
    const { start, remote, store, ws } = await cloud();
    const p = await saveProduct({ ...emptyProduct(), name: 'Viejo' });
    await store.write(`${ws.id}/products`, { ...p });
    await deleteProduct(p.id); // sin motor corriendo
    await tick();
    await start();
    await tick();
    expect(remote('products').get(p.id)).toMatchObject({ _deleted: true });
    expect(await db.products.get(p.id)).toBeUndefined();
  });

  it('una versión vieja que llega después de borrar no lo vuelve a crear', async () => {
    const { start, remote, store, ws } = await cloud();
    await start();
    const p = await saveProduct({ ...emptyProduct(), name: 'X' });
    await tick();
    const old = { ...remote('products').get(p.id)! };
    await deleteProduct(p.id);
    await tick();
    // Otro dispositivo desactualizado sube la versión anterior (sin lápida).
    await store.write(`${ws.id}/products`, old);
    await tick();
    expect(await db.products.get(p.id)).toBeUndefined();
    expect(remote('products').get(p.id)).toMatchObject({ _deleted: true });
  });

  it('un movimiento no cambia updatedAt del producto (no pisa ediciones de otro equipo)', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Y' });
    await applyMovement({ productId: p.id, type: 'ingreso', delta: 5, origin: 'manual' });
    const after = await db.products.get(p.id);
    expect(after!.stock).toBe(5);
    expect(after!.updatedAt).toBe(p.updatedAt);
  });

  it('vinculado a la nube no se siembran configuración ni catálogos', async () => {
    await db.meta.put({ key: CLOUD_LINK_KEY, value: { wsId: 'w', uid: 'u' } });
    await ensureBaseData();
    expect(await db.settings.count()).toBe(0);
    expect(await db.units.count()).toBe(0);
  });
});

describe('copias de seguridad', () => {
  it('sin ser administrador no se exportan los usuarios (hash del PIN)', async () => {
    await saveUser({ name: 'Ana', pin: '1234', role: 'admin', permissions: [], active: true });
    expect((await createBackup()).tables.users).toBeUndefined();
    expect((await createBackup({ includeUsers: true })).tables.users).toHaveLength(1);
  });

  it('restaurar una copia sin usuarios conserva los usuarios actuales', async () => {
    await saveUser({ name: 'Ana', pin: '1234', role: 'admin', permissions: [], active: true });
    const b = await createBackup();
    await restoreBackup(b);
    expect(await db.users.count()).toBe(1);
  });

  it('no se restaura con la nube vinculada, y valida las tablas nuevas', async () => {
    const b = await createBackup();
    await db.meta.put({ key: CLOUD_LINK_KEY, value: { wsId: 'w', uid: 'u' } });
    await expect(restoreBackup(b)).rejects.toThrow(/Desvinculalo/);
    await db.meta.delete(CLOUD_LINK_KEY);
    await expect(restoreBackup({ ...b, tables: { ...b.tables, transfers: [{ id: 't', number: 1, date: '2026-10-08', outletId: 'o', status: 'enviado' }] } })).rejects.toThrow(/transfers/);
  });
});

describe('productos', () => {
  it('no se puede borrar un producto con stock en un punto', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Pan' }, 10);
    const o = await saveOutlet({ name: 'Parador', active: true });
    await createTransfer({ date: '2026-10-08', outletId: o.id, items: [{ productId: p.id, quantity: 2 }] });
    await expect(deleteProduct(p.id)).rejects.toThrow(/Desactivalo/);
    await expect(saveProduct({ ...emptyProduct(), name: 'Neg' }, -5)).rejects.toThrow(/negativo/);
  });

  it('el importador no duplica filas repetidas', async () => {
    const plan = await planProductImport({ headers: ['Nombre', 'Código', 'Stock'], rows: [['Agua', 'A1', '1.500'], ['Agua', 'A1', '3']] });
    expect(plan.create).toBe(1);
    await plan.run();
    const all = await db.products.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].stock).toBe(1500);
  });
});

describe('formatos', () => {
  it('números en formato argentino y anglosajón', () => {
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1.500')).toBe(1500);
    expect(parseNumber('12.345.678')).toBe(12345678);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('2.5')).toBe(2.5);
    expect(parseNumber('0.125')).toBe(0.125);
    expect(parseNumber('$ 1.200,00')).toBe(1200);
    expect(parseNumber('-3,25')).toBe(-3.25);
    expect(parseNumber('abc', 7)).toBe(7);
  });

  it('fecha local (no UTC)', () => {
    const late = new Date(2026, 9, 8, 23, 30); // 23:30 hora local
    expect(localYmd(late)).toBe('2026-10-08');
  });
});

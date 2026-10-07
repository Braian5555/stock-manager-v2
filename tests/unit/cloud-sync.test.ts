import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { FakeBackend, FakeCloudStore } from '../../src/cloud/fakeBackend';
import { SyncEngine } from '../../src/cloud/syncEngine';
import type { RemoteDoc } from '../../src/cloud/types';
import { emptyProduct, saveProduct, deleteProduct } from '../../src/services/productService';
import { applyMovement, foldStock, movementIdForKey } from '../../src/services/stockService';
import { ensureBaseData, loadDemoData } from '../../src/services/seedService';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let engine: SyncEngine | undefined;

async function setup(opts: { pushAll?: boolean } = {}) {
  const store = new FakeCloudStore();
  const backend = new FakeBackend(store);
  const user = await backend.signIn();
  const ws = await backend.createWorkspace(user, 'Test');
  engine = new SyncEngine(backend, ws.id);
  await engine.start(opts);
  await tick();
  const remote = (table: string) => store.coll(`${ws.id}/${table}`);
  /** Escribe como si fuera OTRO dispositivo. */
  const otherDevice = (table: string, doc: RemoteDoc) => store.write(`${ws.id}/${table}`, doc);
  return { store, ws, remote, otherDevice };
}

afterEach(() => {
  engine?.stop();
  engine = undefined;
});

describe('sincronización con la nube', () => {
  it('al crear el espacio sube todos los datos locales', async () => {
    await ensureBaseData();
    await loadDemoData();
    const { remote } = await setup({ pushAll: true });
    await tick(80);
    expect(remote('products').size).toBe(15);
    expect(remote('movements').size).toBe(await db.movements.count());
    expect(remote('settings').get('app')).toBeDefined();
    expect(engine!.getStatus().state).toBe('synced');
  });

  it('los cambios locales se suben y las eliminaciones dejan lápida', async () => {
    const { remote } = await setup();
    const p = await saveProduct({ ...emptyProduct(), name: 'Hielo 10 kg' }, 4);
    await tick();
    expect(remote('products').get(p.id)?.name).toBe('Hielo 10 kg');
    expect(remote('movements').size).toBe(1);
    await deleteProduct(p.id);
    await tick();
    expect(remote('products').get(p.id)).toMatchObject({ id: p.id, _deleted: true });
  });

  it('aplica cambios remotos más nuevos y no pisa los locales más nuevos', async () => {
    const { remote, otherDevice } = await setup();
    const p = await saveProduct({ ...emptyProduct(), name: 'Original' }, 10);
    await tick();
    await otherDevice('products', { ...remote('products').get(p.id)!, name: 'Editado en el celular', updatedAt: '2999-01-01T00:00:00.000Z' });
    await tick();
    expect((await db.products.get(p.id))!.name).toBe('Editado en el celular');
    expect((await db.products.get(p.id))!.stock).toBe(10); // el stock no viene del documento remoto
    await otherDevice('products', { ...remote('products').get(p.id)!, name: 'Viejo', updatedAt: '2000-01-01T00:00:00.000Z' });
    await tick();
    expect((await db.products.get(p.id))!.name).toBe('Editado en el celular');
  });

  it('una lápida remota elimina el registro local', async () => {
    const { otherDevice } = await setup();
    const p = await saveProduct({ ...emptyProduct(), name: 'Borrar' });
    await tick();
    await otherDevice('products', { id: p.id, _deleted: true, updatedAt: '2999-01-01T00:00:00.000Z' });
    await tick();
    expect(await db.products.get(p.id)).toBeUndefined();
  });

  it('movimientos simultáneos en dos dispositivos se suman sin perder stock', async () => {
    const { otherDevice, remote } = await setup();
    const p = await saveProduct({ ...emptyProduct(), name: 'Agua' }, 10); // +10
    await tick();
    // Este dispositivo: salida de 2. El otro (sin haberse enterado): ingreso de 5.
    await applyMovement({ productId: p.id, type: 'salida', delta: -2, origin: 'manual' });
    const t = new Date().toISOString();
    await otherDevice('movements', { id: 'remote-1', productId: p.id, type: 'ingreso', quantityBefore: 10, quantityAfter: 15, delta: 5, origin: 'manual', sourceSystem: 'local', idempotencyKey: 'local:remote-1', createdAt: t, updatedAt: t });
    await tick();
    expect((await db.products.get(p.id))!.stock).toBe(13);
    // Un conteo (valor absoluto) posterior fija el stock.
    const t2 = new Date(Date.now() + 1000).toISOString();
    await otherDevice('movements', { id: 'remote-2', productId: p.id, type: 'conteo', quantityBefore: 15, quantityAfter: 9, delta: -6, absolute: true, origin: 'conteo', sourceSystem: 'local', idempotencyKey: 'count:c1:' + p.id, createdAt: t2, updatedAt: t2 });
    await tick();
    expect((await db.products.get(p.id))!.stock).toBe(9);
    expect(remote('movements').size).toBe(4);
  });

  it('un mismo hecho registrado en dos dispositivos no se duplica', async () => {
    const { otherDevice } = await setup();
    const p = await saveProduct({ ...emptyProduct(), name: 'X' }, 1);
    const key = 'order:o1:item:i1';
    await applyMovement({ productId: p.id, type: 'ingreso', delta: 5, origin: 'pedido', idempotencyKey: key });
    await tick();
    const t = new Date().toISOString();
    // El otro dispositivo recibió el mismo pedido: mismo id determinístico → mismo documento.
    await otherDevice('movements', { id: movementIdForKey(key), productId: p.id, type: 'ingreso', quantityBefore: 1, quantityAfter: 6, delta: 5, origin: 'pedido', sourceSystem: 'local', idempotencyKey: key, createdAt: t, updatedAt: t });
    // Y un registro viejo con otro id pero la misma clave: se ignora.
    await otherDevice('movements', { id: 'legacy-id', productId: p.id, type: 'ingreso', quantityBefore: 1, quantityAfter: 6, delta: 5, origin: 'pedido', sourceSystem: 'local', idempotencyKey: key, createdAt: t, updatedAt: t });
    await tick();
    expect(await db.movements.where('idempotencyKey').equals(key).count()).toBe(1);
    expect((await db.products.get(p.id))!.stock).toBe(6);
  });

  it('sin conexión los cambios quedan pendientes y se envían al volver', async () => {
    const { store, remote } = await setup();
    store.setOnline(false);
    const p = await saveProduct({ ...emptyProduct(), name: 'Offline' });
    await tick();
    expect(remote('products').has(p.id)).toBe(false);
    expect(engine!.getStatus().pending).toBeGreaterThan(0);
    store.setOnline(true);
    await tick();
    expect(remote('products').has(p.id)).toBe(true);
    expect(engine!.getStatus().pending).toBe(0);
  });

  it('al conectarse, lo que sólo existe localmente se sube', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Hecho sin sesión' });
    const { remote } = await setup();
    await tick();
    expect(remote('products').has(p.id)).toBe(true);
  });

  it('foldStock respeta el orden y los valores absolutos', () => {
    const m = (id: string, at: string, delta: number, after: number, absolute = false) =>
      ({ id, createdAt: at, delta, quantityAfter: after, absolute }) as never;
    expect(foldStock([m('b', '2', -3, 7), m('a', '1', 10, 10), m('c', '3', 0, 4, true), m('d', '4', 2, 6)])).toBe(6);
    expect(foldStock([])).toBeUndefined();
  });
});

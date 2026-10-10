import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { buildCountReport } from '../../src/exports/countReport';
import { saveEntity } from '../../src/services/entityService';
import { applyCount, finishCount, movedSinceStart, setCounted, startCount } from '../../src/services/countService';
import { bulkUpdateProducts, emptyProduct, saveProduct } from '../../src/services/productService';
import { applyMovement } from '../../src/services/stockService';
import { setCurrentActor } from '../../src/services/userService';

afterEach(() => setCurrentActor(undefined));

describe('cambios en lote', () => {
  it('cambia el campo elegido en todos, sin tocar el stock, y el deshacer restaura sólo eso', async () => {
    const fam = await saveEntity(db.categories, { name: 'Hormas' });
    const a = await saveProduct({ ...emptyProduct(), name: 'Queso A' }, 5);
    const b = await saveProduct({ ...emptyProduct(), name: 'Queso B', minStock: 2 }, 1);
    const r = await bulkUpdateProducts([a.id, b.id], { categoryId: fam.id, minStock: 3 });
    expect(r.changed).toBe(2);
    let [na, nb] = await db.products.bulkGet([a.id, b.id]);
    expect([na!.categoryId, nb!.categoryId]).toEqual([fam.id, fam.id]);
    expect([na!.minStock, nb!.minStock]).toEqual([3, 3]);
    expect([na!.stock, nb!.stock]).toEqual([5, 1]);
    expect(await db.movements.count()).toBe(2); // sólo los stocks iniciales

    // Mientras tanto otro cambio (p. ej. sincronizado) en otro campo: el deshacer no lo pisa.
    await saveProduct({ ...na!, notes: 'nota nueva' });
    await r.undo.restore();
    [na, nb] = await db.products.bulkGet([a.id, b.id]);
    expect(na!.categoryId).toBeUndefined();
    expect([na!.minStock, nb!.minStock]).toEqual([0, 2]);
    expect(na!.notes).toBe('nota nueva');
  });

  it('valida todo antes de escribir: si en uno el máximo queda menor que el mínimo, no cambia ninguno', async () => {
    const a = await saveProduct({ ...emptyProduct(), name: 'Uno', maxStock: 10 });
    const b = await saveProduct({ ...emptyProduct(), name: 'Dos', maxStock: 4 });
    await expect(bulkUpdateProducts([a.id, b.id], { minStock: 5 })).rejects.toThrow(/“Dos”.*máximo quedaría menor/);
    expect((await db.products.get(a.id))!.minStock).toBe(0);
    await expect(bulkUpdateProducts([a.id], { minStock: -1 })).rejects.toThrow();
    await expect(bulkUpdateProducts([a.id], {})).rejects.toThrow(/Elegí qué cambiar/);
    // Cambiando los dos juntos sí se puede.
    await expect(bulkUpdateProducts([a.id, b.id], { minStock: 5, maxStock: 12 })).resolves.toMatchObject({ changed: 2 });
  });

  it('proveedor principal: lo saca de alternativos y el deshacer lo devuelve', async () => {
    const s1 = await saveEntity(db.suppliers, { name: 'S1' });
    const s2 = await saveEntity(db.suppliers, { name: 'S2' });
    const p = await saveProduct({ ...emptyProduct(), name: 'Harina', supplierId: s1.id, alternativeSupplierIds: [s2.id] });
    const r = await bulkUpdateProducts([p.id], { supplierId: s2.id });
    expect(await db.products.get(p.id)).toMatchObject({ supplierId: s2.id, alternativeSupplierIds: [] });
    await r.undo.restore();
    expect(await db.products.get(p.id)).toMatchObject({ supplierId: s1.id, alternativeSupplierIds: [s2.id] });
  });

  it('quitar un dato (dejar sin ubicación) y no contar los que ya tenían ese valor', async () => {
    const loc = await saveEntity(db.locations, { name: 'Cámara 1' });
    const a = await saveProduct({ ...emptyProduct(), name: 'A', locationId: loc.id });
    const b = await saveProduct({ ...emptyProduct(), name: 'B' });
    const r = await bulkUpdateProducts([a.id, b.id], { locationId: undefined });
    expect(r.changed).toBe(1);
    expect((await db.products.get(a.id))!.locationId).toBeUndefined();
  });
});

describe('conteos auditables', () => {
  it('registra quién contó, finalizó y aplicó; avisa lo que se movió durante el conteo', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Horma Tybo' }, 10);
    const q = await saveProduct({ ...emptyProduct(), name: 'Horma Reggianito' }, 4);
    setCurrentActor({ id: 'u1', name: 'Ana' });
    const c = await startCount({ name: 'Hormas' });
    const items = await db.countItems.where('countId').equals(c.id).toArray();
    const ip = items.find((i) => i.productId === p.id)!;
    const iq = items.find((i) => i.productId === q.id)!;

    setCurrentActor({ id: 'u2', name: 'Beto' });
    await setCounted(ip.id, 8);
    await setCounted(iq.id, 4);
    expect(await db.countItems.get(ip.id)).toMatchObject({ counted: 8, countedBy: { name: 'Beto' } });
    expect((await db.countItems.get(ip.id))!.countedAt).toBeTruthy();
    // Borrar la cantidad borra también quién la cargó.
    await setCounted(iq.id, undefined);
    expect((await db.countItems.get(iq.id))!.countedBy).toBeUndefined();
    await setCounted(iq.id, 4);

    // Mientras se contaba hubo una salida.
    await applyMovement({ productId: p.id, type: 'salida', delta: -1, origin: 'manual' });
    const moved = await movedSinceStart(c.id);
    expect(moved).toEqual([{ productId: p.id, expected: 10, current: 9, counted: 8 }]);

    await finishCount(c.id);
    setCurrentActor({ id: 'u1', name: 'Ana' });
    await applyCount(c.id);
    const count = (await db.counts.get(c.id))!;
    expect(count.createdBy?.name).toBe('Ana');
    expect(count.finishedBy?.name).toBe('Beto');
    expect(count.appliedBy?.name).toBe('Ana');
    expect((await db.products.get(p.id))!.stock).toBe(8);

    const report = await buildCountReport(c.id);
    const rows = report.datasets[0].rows;
    expect(rows[0]).toEqual(expect.arrayContaining(['Horma Tybo', 10, 8, -2, 'Beto']));
    expect(rows[1][6]).toBe(0);
    expect(report.summary.join('\n')).toMatch(/Empezado: .* por Ana/);
    expect(report.summary.join('\n')).toMatch(/Aplicado al stock: .* por Ana/);
    expect(report.summary.join('\n')).toMatch(/Con diferencia: 1/);
  });
});

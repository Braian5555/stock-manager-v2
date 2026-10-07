import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { createSuggestedOrders, receiveOrder, saveOrder, suggestOrders, duplicateOrder } from '../../src/services/orderService';
import { applyCount, finishCount, setCounted, startCount, summarizeCount } from '../../src/services/countService';
import { saveEntity } from '../../src/services/entityService';

describe('pedidos', () => {
  it('recibir un pedido suma stock con factor y no duplica si se recibe dos veces', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Agua', purchaseFactor: 12 }, 5);
    const order = await saveOrder({ status: 'pendiente', date: new Date().toISOString(), items: [{ productId: p.id, quantity: 2 }] });
    expect(order.number).toBe(1);
    const s = await receiveOrder(order.id);
    expect(s.lines[0]).toMatchObject({ before: 5, added: 24, after: 29 });
    await receiveOrder(order.id);
    expect((await db.products.get(p.id))!.stock).toBe(29);
    expect((await db.orders.get(order.id))!.status).toBe('recibido');
    const movs = await db.movements.where('refId').equals(order.id).toArray();
    expect(movs).toHaveLength(1);
  });

  it('recibe cantidades parciales y no permite editar un pedido recibido', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'B' }, 5);
    const o = await saveOrder({ status: 'enviado', date: new Date().toISOString(), items: [{ productId: p.id, quantity: 10 }] });
    const [item] = await db.orderItems.where('orderId').equals(o.id).toArray();
    await receiveOrder(o.id, [{ itemId: item.id, receivedQuantity: 7 }]);
    expect((await db.products.get(p.id))!.stock).toBe(12);
    await expect(saveOrder({ id: o.id, status: 'pendiente', date: o.date, items: [] })).rejects.toThrow();
    const dup = await duplicateOrder(o.id);
    expect(dup).toMatchObject({ number: 2, status: 'borrador' });
  });

  it('pedido sugerido: stock 2, mínimo 10, máximo 30 → 28 y agrupa por proveedor', async () => {
    const supA = await saveEntity(db.suppliers, { name: 'Proveedor A' });
    const supB = await saveEntity(db.suppliers, { name: 'Proveedor B' });
    const a = await saveProduct({ ...emptyProduct(), name: 'A', minStock: 10, maxStock: 30, supplierId: supA.id }, 2);
    await saveProduct({ ...emptyProduct(), name: 'B', minStock: 4, maxStock: 12, supplierId: supB.id, purchaseFactor: 5 }, 1);
    await saveProduct({ ...emptyProduct(), name: 'OK', minStock: 1, maxStock: 5, supplierId: supA.id }, 4);
    const groups = suggestOrders(await db.products.toArray(), { suggestionMode: 'toMax' });
    expect(groups).toHaveLength(2);
    const ga = groups.find((g) => g.supplierId === supA.id)!;
    expect(ga.lines).toHaveLength(1);
    expect(ga.lines[0]).toMatchObject({ needed: 28, quantity: 28 });
    expect(ga.lines[0].product.id).toBe(a.id);
    const gb = groups.find((g) => g.supplierId === supB.id)!;
    expect(gb.lines[0]).toMatchObject({ needed: 11, quantity: 3 }); // 11 u / 5 por caja → 3 cajas
    const toMin = suggestOrders(await db.products.toArray(), { suggestionMode: 'toMin' });
    expect(toMin.find((g) => g.supplierId === supA.id)!.lines[0].quantity).toBe(8);
    const orders = await createSuggestedOrders(groups);
    expect(orders).toHaveLength(2);
    expect(orders.every((o) => o.status === 'borrador')).toBe(true);
  });
});

describe('conteo', () => {
  it('cuenta, resume diferencias y aplica una sola vez', async () => {
    const a = await saveProduct({ ...emptyProduct(), name: 'A' }, 12);
    const b = await saveProduct({ ...emptyProduct(), name: 'B' }, 8);
    const c = await saveProduct({ ...emptyProduct(), name: 'C' }, 15);
    await saveProduct({ ...emptyProduct(), name: 'D' }, 3);
    const count = await startCount({ name: 'Conteo test' });
    const items = await db.countItems.where('countId').equals(count.id).toArray();
    const by = (id: string) => items.find((i) => i.productId === id)!;
    await setCounted(by(a.id).id, 10);
    await setCounted(by(b.id).id, 9);
    await setCounted(by(c.id).id, 15);
    const summary = summarizeCount(await db.countItems.where('countId').equals(count.id).toArray());
    expect(summary).toMatchObject({ total: 4, counted: 3, uncounted: 1 });
    expect(summary.decreases.map((l) => l.difference)).toEqual([-2]);
    expect(summary.increases.map((l) => l.difference)).toEqual([1]);
    expect(summary.unchanged).toHaveLength(1);
    await finishCount(count.id);
    expect(await applyCount(count.id)).toBe(2);
    expect(await applyCount(count.id)).toBe(0);
    expect((await db.products.get(a.id))!.stock).toBe(10);
    expect((await db.products.get(b.id))!.stock).toBe(9);
    const movs = await db.movements.where('refId').equals(count.id).toArray();
    expect(movs.map((m) => m.type)).toEqual(['conteo', 'conteo']);
  });

  it('filtra por ubicación', async () => {
    const loc = await saveEntity(db.locations, { name: 'Cámara' });
    await saveProduct({ ...emptyProduct(), name: 'En cámara', locationId: loc.id });
    await saveProduct({ ...emptyProduct(), name: 'Otro' });
    const count = await startCount({ locationId: loc.id });
    expect(await db.countItems.where('countId').equals(count.id).count()).toBe(1);
  });
});

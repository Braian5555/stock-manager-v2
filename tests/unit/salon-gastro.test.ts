import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { buildCosts } from '../../src/services/costService';
import { dishCost, netPrice } from '../../src/services/menuCostService';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { ticketConsumption } from '../../src/services/saleStockService';
import { periodRange, salesReport } from '../../src/services/salesReportService';
import { addLine, addNumberedTables, closeTicket, openTicket, saveMenuItem, sendToKitchen, setComp } from '../../src/services/salonService';
import { updateSettings } from '../../src/services/settingsService';
import type { TableTicket } from '../../src/models';

async function product(name: string, stock: number, cost?: number) {
  return saveProduct({ ...emptyProduct(), name, cost }, stock);
}

async function setup() {
  const cafe = await product('Café en grano', 10, 20000); // kg
  const leche = await product('Leche', 50, 1200); // l
  const medialuna = await product('Medialuna', 40); // sin costo
  const cl = await saveMenuItem({ name: 'Café con leche', section: 'Cafetería', price: 3000, kitchen: false, recipe: { yield: 1, items: [{ productId: cafe.id, quantity: 0.018 }, { productId: leche.id, quantity: 0.15 }] } });
  const des = await saveMenuItem({ name: 'Desayuno', section: 'Desayunos', price: 9000, kitchen: true, recipe: { yield: 1, items: [{ productId: medialuna.id, quantity: 2 }, { productId: cafe.id, quantity: 0.018 }] } });
  const agua = await saveMenuItem({ name: 'Agua', section: 'Bebidas', price: 1500, kitchen: false });
  await addNumberedTables(1, 4, 'Salón');
  const tables = await db.diningTables.orderBy('order').toArray();
  return { cafe, leche, medialuna, cl, des, agua, tables };
}

describe('stock al vender', () => {
  it('al cerrar el pedido descuenta las recetas (también las cortesías) una sola vez', async () => {
    const { cafe, leche, medialuna, cl, des, agua, tables } = await setup();
    let t = await openTicket(tables[0].id);
    await addLine(t.id, cl, 2);
    await addLine(t.id, des, 1);
    t = await addLine(t.id, agua, 1);
    t = await setComp(t.id, t.lines[0].id, true);
    await sendToKitchen(t.id);
    await closeTicket(t.id);
    expect((await db.products.get(cafe.id))!.stock).toBe(9.946); // 10 − 3 × 0,018
    expect((await db.products.get(leche.id))!.stock).toBe(49.7);
    expect((await db.products.get(medialuna.id))!.stock).toBe(38);
    const moves = await db.movements.where('type').equals('venta').toArray();
    expect(moves).toHaveLength(3);
    expect(moves.every((m) => m.refId === t.id && m.origin === 'salon')).toBe(true);
    expect(moves.find((m) => m.productId === medialuna.id)!.reason).toBe('Venta · Mesa 1 · #1');
  });

  it('apagado en la configuración, no toca el stock', async () => {
    const { medialuna, des, tables } = await setup();
    await updateSettings({ salonStock: false });
    const t = await openTicket(tables[0].id);
    await addLine(t.id, des, 3);
    await sendToKitchen(t.id);
    await closeTicket(t.id);
    expect((await db.products.get(medialuna.id))!.stock).toBe(40);
    expect(await db.movements.where('type').equals('venta').count()).toBe(0);
  });

  it('la receta por tanda se divide por lo que rinde; sin receta no consume', () => {
    const use = ticketConsumption(
      { lines: [{ menuItemId: 'a', qty: 3 }, { menuItemId: 'b', qty: 2 }, { menuItemId: 'a', qty: 0 }] as TableTicket['lines'] },
      new Map([['a', { recipe: { yield: 4, items: [{ productId: 'harina', quantity: 1 }] } }], ['b', {}]]),
    );
    expect([...use]).toEqual([['harina', 0.75]]);
  });
});

describe('costo y margen de la carta', () => {
  it('suma la receta con el costo de cada insumo; margen sobre el precio sin IVA si es RI', async () => {
    const { cl, des } = await setup();
    const products = await db.products.toArray();
    const { costOf } = buildCosts(products, []);
    const byId = new Map(products.map((p) => [p.id, p]));
    const c = dishCost(cl, costOf, byId)!;
    expect(c.cost).toBe(540); // 0,018 × 20.000 + 0,15 × 1.200
    expect(c.margin).toBe(2460);
    expect(c.pct).toBe(18);
    const ri = dishCost(cl, costOf, byId, { enabled: true, condicionIva: 'RI', ivaDefault: 21 })!;
    expect(ri.net).toBe(2479.34);
    expect(ri.pct).toBe(21.8);
    const d = dishCost(des, costOf, byId)!;
    expect(d.missing).toEqual(['Medialuna']);
    expect(d.cost).toBe(360);
    expect(netPrice({ price: 1105, iva: 10.5 }, { enabled: true, condicionIva: 'RI', ivaDefault: 21 })).toBe(1000);
  });
});

describe('reportes de ventas', () => {
  it('totales, por plato con costo, por medio de pago, canal, mozo, hora y día', async () => {
    const { cl, des, agua } = await setup();
    const products = await db.products.toArray();
    const { costOf } = buildCosts(products, []);
    const day = periodRange('hoy');
    const at = (h: number) => { const d = new Date(); d.setHours(h, 15, 0, 0); return d.toISOString(); };
    const line = (m: { id: string; name: string; price: number }, qty: number, comp = false) => ({ id: `${m.id}${qty}${comp}`, menuItemId: m.id, name: m.name, price: m.price, qty, kitchen: false, status: 'entregado' as const, comp });
    const base = { createdAt: at(9), updatedAt: at(9), tableId: 't', tableName: 'Mesa 1', status: 'cerrada' as const };
    const tickets: TableTicket[] = [
      { ...base, id: 'a', number: 1, openedAt: at(9), closedAt: at(10), openedBy: { id: 'u1', name: 'Ana' }, guests: 2, lines: [line(cl, 2), line(agua, 1, true)], subtotal: 6000, total: 6000, payments: [{ method: 'efectivo', amount: 6000 }] },
      { ...base, id: 'b', number: 2, openedAt: at(13), closedAt: at(14), openedBy: { id: 'u2', name: 'Beto' }, channel: 'delivery', lines: [line(des, 1)], subtotal: 9000, discount: { kind: 'pct', value: 10 }, total: 8100,
        charges: [{ id: 'c', at: at(14), amount: 8100, payments: [{ method: 'debito', amount: 8100 }], tip: { amount: 500, method: 'efectivo' } }] },
      { ...base, id: 'c', number: 3, openedAt: at(15), closedAt: at(15), status: 'anulada', lines: [], total: 0 },
      { ...base, id: 'd', number: 4, openedAt: '2020-01-01T12:00:00.000Z', closedAt: '2020-01-01T13:00:00.000Z', lines: [line(cl, 5)], total: 15000 },
    ];
    const r = salesReport(tickets, day, { menu: new Map((await db.menuItems.toArray()).map((m) => [m.id, m])), costOf, products: new Map(products.map((p) => [p.id, p])) });
    expect(r).toMatchObject({ sold: 14100, orders: 2, avg: 7050, guests: 2, discounts: 900, tips: 500, compValue: 1500, cancelled: 1 });
    expect(r.items.map((i) => [i.name, i.qty, i.revenue, i.cost])).toEqual([
      ['Desayuno', 1, 9000, 360], ['Café con leche', 2, 6000, 1080], ['Agua', 1, 0, undefined],
    ]);
    expect(r.cost).toBe(1440);
    expect(r.byPayment.map((b) => [b.label, b.total])).toEqual([['Débito', 8100], ['Efectivo', 6000]]);
    expect(r.byChannel.map((b) => b.label)).toEqual(['Delivery', 'Mesa']);
    expect(r.byWaiter.map((b) => [b.label, b.count])).toEqual([['Beto', 1], ['Ana', 1]]);
    expect(r.byHour.map((b) => b.key)).toEqual(['09', '13']);
    expect(r.byDay).toHaveLength(1);
  });

  it('períodos rápidos', () => {
    const today = new Date(2026, 10, 6, 15);
    expect(periodRange('ayer', today)).toEqual({ from: '2026-11-05', to: '2026-11-05' });
    expect(periodRange('7d', today)).toEqual({ from: '2026-10-31', to: '2026-11-06' });
    expect(periodRange('mes', today)).toEqual({ from: '2026-11-01', to: '2026-11-06' });
    expect(periodRange('mesAnterior', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});

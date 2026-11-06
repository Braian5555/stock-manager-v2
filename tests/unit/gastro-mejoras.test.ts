import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import type { FiscalDoc, Product, StockMovement, TableTicket } from '../../src/models';
import { dailyClose, ivaBook } from '../../src/services/closingService';
import { daysLabel, usageByProduct } from '../../src/services/consumptionService';
import { suggestOrders } from '../../src/services/orderService';
import { comandaHtml } from '../../src/services/printService';
import { addLine, addNumberedTables, markLinesReady, openTicket, saveMenuItem, sendToKitchen, waitingSince } from '../../src/services/salonService';

describe('cocina y barra', () => {
  it('cada plato va a su puesto; la barra marca listo lo suyo; demora desde el más viejo', async () => {
    const cafe = await saveMenuItem({ name: 'Café', section: 'Cafetería', price: 2000, kitchen: true, station: 'barra' });
    const tostado = await saveMenuItem({ name: 'Tostado', section: 'Salado', price: 5000, kitchen: true });
    const agua = await saveMenuItem({ name: 'Agua', section: 'Bebidas', price: 1000, kitchen: false, station: 'barra' });
    expect(agua.station).toBeUndefined(); // si no va a pantalla, no tiene puesto
    await addNumberedTables(1, 1, 'Salón');
    const [mesa] = await db.diningTables.toArray();
    let t = await openTicket(mesa.id);
    await addLine(t.id, cafe, 2);
    await addLine(t.id, tostado, 1);
    ({ ticket: t } = await sendToKitchen(t.id));
    expect(t.lines.map((l) => [l.name, l.station ?? 'cocina', l.status])).toEqual([['Café', 'barra', 'cocina'], ['Tostado', 'cocina', 'cocina']]);
    expect(waitingSince(t)).toBe(t.lines[0].sentAt);
    const html = comandaHtml(t, t.lines);
    expect(html).toContain('COMANDA BARRA');
    expect(html).toContain('COMANDA COCINA');
    expect(html).toContain('page-break-before');
    t = await markLinesReady(t.id, t.lines.filter((l) => l.station === 'barra').map((l) => l.id));
    expect(t.lines.map((l) => l.status)).toEqual(['listo', 'cocina']);
    expect(waitingSince(t, 'barra')).toBeUndefined();
    expect(waitingSince(t, 'cocina')).toBeDefined();
  });
});

const doc = (o: Partial<FiscalDoc>): FiscalDoc => ({
  id: crypto.randomUUID(), createdAt: '2026-11-03T12:00:00.000Z', updatedAt: '', kind: 'factura', letra: 'B', cbteTipo: 6, ptoVta: 5, ambiente: 'produccion', concepto: 1,
  emisor: {} as FiscalDoc['emisor'], receptor: { docTipo: 99, docNro: '0', condicionIva: 5 }, lines: [], impTotal: 0, impNeto: 0, impIva: 0, impTotConc: 0, impOpEx: 0, impTrib: 0, iva: [],
  status: 'autorizada', ...o,
} as FiscalDoc);

describe('libro IVA ventas y cierre del día', () => {
  const docs = [
    doc({ nro: 41, fecha: '20261103', impTotal: 12100, impNeto: 10000, impIva: 2100, iva: [{ id: 5, rate: 21, baseImp: 10000, importe: 2100 }], cae: '1' }),
    doc({ nro: 42, fecha: '20261103', impTotal: 1105, impNeto: 1000, impIva: 105, iva: [{ id: 4, rate: 10.5, baseImp: 1000, importe: 105 }] }),
    doc({ kind: 'nc', cbteTipo: 8, nro: 3, fecha: '20261104', impTotal: 1210, impNeto: 1000, impIva: 210, iva: [{ id: 5, rate: 21, baseImp: 1000, importe: 210 }] }),
    doc({ cbteTipo: 1, letra: 'A', nro: 7, fecha: '20261110', impTotal: 2420, impNeto: 2000, impIva: 420, iva: [{ id: 5, rate: 21, baseImp: 2000, importe: 420 }], receptor: { docTipo: 80, docNro: '30712345671', nombre: 'Cliente SA', condicionIva: 1 } }),
    doc({ nro: 43, fecha: '20261201', impTotal: 999 }), // otro mes
    doc({ nro: 44, fecha: '20261105', impTotal: 500, ambiente: 'homologacion' }), // prueba
    doc({ nro: 45, fecha: '20261105', impTotal: 800, status: 'rechazada' }),
  ];

  it('toma los autorizados del mes, NC en negativo, neto e IVA por alícuota', () => {
    const b = ivaBook(docs, '2026-11');
    expect(b.count).toBe(4);
    expect(b.rates).toEqual([21, 10.5]);
    expect(b.totals).toMatchObject({ neto: 12000, iva: 2415, total: 14415 });
    expect(b.totals.byRate.get(21)).toEqual({ base: 11000, iva: 2310 });
    expect(b.byType.map((t) => [t.name, t.count, t.first, t.last, t.total])).toEqual([
      ['Factura A', 1, 7, 7, 2420], ['Factura B', 2, 41, 42, 13205], ['Nota de crédito B', 1, 3, 3, -1210],
    ]);
    expect(b.rows[0].slice(0, 4)).toEqual(['03/11/2026', 'Factura B', 5, '00005-00000041']);
    expect(b.rows.at(-1)![0]).toBe('TOTAL');
    expect(b.rows.find((r) => r[1] === 'Factura A')!.slice(4, 8)).toEqual(['CUIT', '30712345671', 'Cliente SA', 'IVA Responsable Inscripto']);
    expect(ivaBook(docs, '2026-11', true).count).toBe(5);
  });

  it('cierre del día: ventas, facturado por tipo y lo cobrado sin factura', () => {
    const at = (h: number) => new Date(2026, 10, 3, h).toISOString();
    const t = (o: Partial<TableTicket>): TableTicket => ({ id: crypto.randomUUID(), createdAt: at(9), updatedAt: at(9), number: 1, tableId: 'x', tableName: '1', status: 'cerrada', openedAt: at(9), closedAt: at(10), lines: [], total: 0, ...o } as TableTicket);
    const facturada = docs[0];
    const tickets = [
      t({ total: 12100, charges: [{ id: 'a', at: at(10), amount: 12100, payments: [{ method: 'efectivo', amount: 12100 }], fiscalDocId: facturada.id }] }),
      t({ total: 3000, charges: [{ id: 'b', at: at(11), amount: 3000, payments: [{ method: 'qr', amount: 3000 }] }] }),
    ];
    const z = dailyClose('2026-11-03', tickets, docs, { menu: new Map() });
    expect(z.sales).toMatchObject({ sold: 15100, orders: 2 });
    expect(z.fiscal.map((f) => [f.name, f.count, f.total])).toEqual([['Factura B', 2, 13205]]);
    expect(z.invoiced).toBe(13205);
    expect(z.unbilled).toBe(3000);
    expect(z.test).toBe(false);
  });
});

describe('stock inteligente', () => {
  const now = new Date('2026-11-06T12:00:00Z').getTime();
  const ago = (d: number) => new Date(now - d * 864e5).toISOString();
  const mv = (productId: string, type: StockMovement['type'], delta: number, d: number, extra: Partial<StockMovement> = {}): StockMovement =>
    ({ id: crypto.randomUUID(), createdAt: ago(d), updatedAt: ago(d), productId, type, delta, quantityBefore: 0, quantityAfter: 0, origin: 'manual', ...extra } as StockMovement);

  it('consumo real: ventas, consumo, mermas y faltantes de conteo; lo deshecho no cuenta', () => {
    const undone = mv('a', 'salida', -50, 2);
    const ms = [
      mv('a', 'venta', -10, 1), mv('a', 'consumo', -5, 3), mv('a', 'perdida', -3, 4), mv('a', 'conteo', -2, 5), mv('a', 'conteo', 4, 6),
      mv('a', 'ingreso', 100, 2), undone, mv('a', 'salida', 50, 2, { idempotencyKey: `undo:${undone.id}` }), mv('a', 'venta', -99, 40),
      mv('b', 'venta', -1, 1),
    ];
    const u = usageByProduct([{ id: 'a', stock: 32, active: true, createdAt: ago(100) }, { id: 'b', stock: 0, active: true, createdAt: ago(2) }], ms, 30, now);
    expect(u.get('a')).toMatchObject({ used: 16, waste: 3, days: 30, perDay: 0.533 });
    expect(u.get('a')!.daysLeft).toBe(60);
    expect(u.get('b')).toMatchObject({ used: 1, days: 2, perDay: 0.5, daysLeft: 0 });
    expect(daysLabel(0.4)).toBe('menos de 1 día');
    expect(daysLabel(12.7)).toBe('12 días');
  });

  it('pedido según consumo: cubre N días (sin bajar del mínimo); sin consumo usa el mínimo', () => {
    const p = (id: string, stock: number, minStock: number): Product => ({ id, name: id, stock, minStock, maxStock: 0, active: true, purchaseFactor: 1, alternativeSupplierIds: [] } as unknown as Product);
    const usage = new Map([['leche', { used: 60, perDay: 2, waste: 0, days: 30, daysLeft: 5 }], ['cafe', { used: 3, perDay: 0.1, waste: 0, days: 30, daysLeft: 50 }]]);
    const g = suggestOrders([p('leche', 10, 4), p('cafe', 5, 1), p('sal', 1, 2)], { suggestionMode: 'byUse', suggestionDays: 7 }, usage);
    expect(g.flatMap((x) => x.lines).map((l) => [l.product.id, l.quantity])).toEqual([['leche', 4], ['sal', 1]]);
  });
});

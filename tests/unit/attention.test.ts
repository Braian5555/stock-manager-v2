import { describe, expect, it } from 'vitest';
import type { Category, InventoryCount, Invoice, Product, StockMovement } from '../../src/models';
import { explainNegative, familiesDue, negativeProducts, pendingInvoices, staleCounts } from '../../src/services/attentionService';

const p = (id: string, stock: number, categoryId?: string): Product => ({ id, name: id, stock, active: true, categoryId } as Product);
let n = 0;
const mv = (productId: string, at: string, type: StockMovement['type'], delta: number, extra: Partial<StockMovement> = {}): StockMovement =>
  ({ id: `m${n++}`, productId, createdAt: at, type, delta, quantityBefore: 0, quantityAfter: 0, origin: 'manual', idempotencyKey: `k${n}`, ...extra } as StockMovement);

describe('para resolver', () => {
  it('explica un negativo: las recetas descontaron y no se cargó la compra', () => {
    const harina = p('Harina', -41);
    const moves = [
      mv('Harina', '2026-10-20T10:00:00Z', 'ajuste', 5, { quantityAfter: 5, origin: 'conteo' }),
      mv('Harina', '2026-10-25T10:00:00Z', 'consumo', -30, { refId: 'prod1' }),
      mv('Harina', '2026-10-26T10:00:00Z', 'consumo', -16, { refId: 'prod2' }),
    ];
    const r = explainNegative(harina, moves);
    expect(r).toMatchObject({ base: 5, recetas: 46, ingresos: 0, otros: 0 });
    expect(r.summary).toMatch(/^Desde el conteo del .*, las recetas descontaron 46 y no entró nada\. Seguramente falta cargar una factura/);
    expect(explainNegative(p('Huevos', -112.636), [mv('Huevos', '2026-10-25T10:00:00Z', 'consumo', -112.636, { refId: 'x' })]).summary).toMatch(/descontaron 112,636 y/);
    expect(negativeProducts([harina, p('Sal', 2)]).map((x) => x.id)).toEqual(['Harina']);
  });

  it('facturas sin cargar, conteos colgados y familias que tocan contar', () => {
    const inv = (id: string, extra: Partial<Invoice> = {}) => ({ id, date: '2026-11-01', pages: [], ...extra } as Invoice);
    expect(pendingInvoices([inv('a'), inv('b', { stockAppliedAt: 'x' }), inv('c', { stockElsewhere: true })]).map((i) => i.id)).toEqual(['a']);

    const c = (id: string, createdAt: string, status: InventoryCount['status'] = 'abierto') => ({ id, name: id, createdAt, status } as InventoryCount);
    expect(staleCounts([c('viejo', '2026-10-23T18:00:00Z'), c('nuevo', '2026-11-02T10:00:00Z'), c('cerrado', '2026-10-01T10:00:00Z', 'aplicado')], new Date('2026-11-03T12:00:00Z')).map((x) => x.id)).toEqual(['viejo']);

    const cats = [{ id: 'pan', name: 'Panaderia' }, { id: 'beb', name: 'Bebidas' }, { id: 'vac', name: 'Vacía' }] as Category[];
    const prods = [p('Medialuna', 1, 'pan'), p('Coca', 3, 'beb')];
    const moves = [mv('Coca', '2026-11-01T10:00:00Z', 'ajuste', 0, { origin: 'conteo' }), mv('Medialuna', '2026-10-20T10:00:00Z', 'ajuste', 0, { origin: 'conteo' })];
    const due = familiesDue(prods, cats, moves, '2026-11-03');
    expect(due.map((d) => d.category.name)).toEqual(['Panaderia']);
    expect(due[0].lastCounted).toBe('2026-10-20T10:00:00Z');
  });
});

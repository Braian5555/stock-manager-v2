import { describe, expect, it } from 'vitest';
import type { Product, StockMovement } from '../../src/models';
import { restockList, usageByProduct } from '../../src/services/restockService';

const settings = { criticalRatio: 0.5, suggestionMode: 'toMax' as const };
const prod = (id: string, extra: Partial<Product> = {}): Product =>
  ({ id, name: id, active: true, stock: 0, minStock: 0, maxStock: 0, purchaseFactor: 1, alternativeSupplierIds: [], createdAt: '', updatedAt: '', ...extra }) as Product;
let k = 0;
const mov = (productId: string, type: StockMovement['type'], delta: number, extra: Partial<StockMovement> = {}): StockMovement =>
  ({ id: `m${++k}`, productId, type, delta, quantityBefore: 0, quantityAfter: 0, origin: 'manual', sourceSystem: 'local', idempotencyKey: `k${k}`, createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '', ...extra }) as StockMovement;

describe('qué hay que reponer', () => {
  it('incluye lo que está en 0 aunque no tenga mínimo, si se usa', () => {
    const products = [
      prod('fernet', { stock: 0 }), // en 0, se vendió: entra con lo de una semana
      prod('vino', { stock: 0 }), // en 0, sin movimientos ni recetas: no entra
      prod('harina', { stock: 0 }), // en 0, insumo de receta: entra
      prod('pan', { stock: 10, recipe: { yield: 1, items: [{ productId: 'harina', quantity: 1 }] } }),
      prod('coca', { stock: 2, minStock: 6, maxStock: 24, purchaseFactor: 6 }), // bajo mínimo
      prod('sal', { stock: -3 }), // negativo
      prod('agua', { stock: 5 }), // bien
    ];
    const moves = [mov('fernet', 'salida', -8), mov('fernet', 'salida', -4), mov('fernet', 'ingreso', 12)];
    const { lines, idleAtZero } = restockList(products, moves, settings);
    expect(lines.map((l) => [l.product.id, l.level])).toEqual([['sal', 'neg'], ['harina', 'out'], ['fernet', 'out'], ['coca', 'crit']]);
    expect(idleAtZero).toBe(1);
    const fernet = lines.find((l) => l.product.id === 'fernet')!;
    expect(fernet).toMatchObject({ weeklyUse: 3, needed: 3, quantity: 3, basis: 'consumo' }); // 12 en 28 días → 3 por semana
    expect(lines.find((l) => l.product.id === 'coca')).toMatchObject({ needed: 22, quantity: 4, basis: 'maximo' }); // hasta 24, cajas de 6
    expect(lines.find((l) => l.product.id === 'harina')).toMatchObject({ basis: 'sin_dato', quantity: undefined });
  });

  it('no cuenta lo deshecho como uso', () => {
    const m = mov('x', 'salida', -5);
    const undo = mov('x', 'ajuste', 5, { idempotencyKey: `undo:${m.id}` });
    expect(usageByProduct([m, undo]).get('x')).toBeUndefined();
  });
});

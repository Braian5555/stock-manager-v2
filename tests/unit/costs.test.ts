import { describe, expect, it } from 'vitest';
import type { Invoice, Product } from '../../src/models';
import { buildCosts, recipesGettingPricier } from '../../src/services/costService';

const p = (id: string, extra: Partial<Product> = {}): Product => ({ id, name: id, active: true, stock: 0, ...extra } as Product);
const inv = (id: string, date: string, items: { productId: string; lineTotal: number; stockQty: number }[]) =>
  ({ id, date, pages: [], items: items.map((i) => ({ ...i, status: 'ok', quantity: i.stockQty, description: i.productId })) } as unknown as Invoice);

describe('costo de recetas', () => {
  const harina = p('Harina');
  const manteca = p('Manteca', { cost: 8000 }); // sin facturas: costo manual
  const masa = p('Masa', { recipe: { yield: 2, items: [{ productId: 'Harina', quantity: 1 }, { productId: 'Manteca', quantity: 0.5 }] } });
  const croissant = p('Croissant', { recipe: { yield: 10, items: [{ productId: 'Masa', quantity: 1 }, { productId: 'Huevo', quantity: 2 }] } });
  const huevo = p('Huevo');
  const invoices = [
    inv('f1', '2026-10-01', [{ productId: 'Harina', lineTotal: 10000, stockQty: 25 }]), // 400 por kg
    inv('f2', '2026-10-20', [{ productId: 'Harina', lineTotal: 12500, stockQty: 25 }]), // 500 por kg
  ];

  it('suma la receta (también recetas dentro de recetas) y avisa lo que no tiene precio', () => {
    const { costOf, recipeCost } = buildCosts([harina, manteca, masa, croissant, huevo], invoices);
    expect(costOf('Harina')).toMatchObject({ cost: 500, source: 'factura', date: '2026-10-20' });
    expect(costOf('Manteca')).toMatchObject({ cost: 8000, source: 'manual' });
    // Masa: (1 × 500 + 0,5 × 8000) / 2 = 2250 por unidad
    expect(recipeCost('Masa')).toMatchObject({ perBatch: 4500, perUnit: 2250, missing: [] });
    // Croissant: (1 masa × 2250 + 2 huevos sin precio) / 10 = 225, incompleto
    const c = recipeCost('Croissant')!;
    expect(c).toMatchObject({ perUnit: 225, missing: ['Huevo'] });
  });

  it('detecta recetas que se encarecieron por el último aumento de un insumo', () => {
    const r = recipesGettingPricier([harina, manteca, masa, huevo], invoices);
    // Masa antes: (400 + 4000) / 2 = 2200 → ahora 2250 = +2,3%: por debajo del 5%
    expect(r).toEqual([]);
    const solo = p('Pan', { recipe: { yield: 1, items: [{ productId: 'Harina', quantity: 1 }] } });
    const r2 = recipesGettingPricier([harina, solo], invoices);
    expect(r2.map((x) => [x.name, x.pct, x.previousPerUnit, x.perUnit])).toEqual([['Pan', 25, 400, 500]]);
  });
});

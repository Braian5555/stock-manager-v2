import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { convertQty, planRecipeImport } from '../../src/importers/recipeImport';
import { parseCsv } from '../../src/importers/tabular';

describe('importar recetas de Maxirest', () => {
  it('pasa las cantidades a la unidad de stock', () => {
    expect(convertQty(3000, 'gr', { abbr: 'kg', name: 'Kilogramo' })).toBe(3);
    expect(convertQty(1200, 'ml', { abbr: 'l', name: 'Litro' })).toBe(1.2);
    expect(convertQty(8, 'unidades', { abbr: 'u', name: 'Unidad' })).toBe(8);
    expect(convertQty(20, 'ml', { abbr: 'bot', name: 'Botella' }, { size: 1000, name: 'bot' })).toBe(0.02);
    expect(convertQty(0.1, 'bolsas 2,5', { abbr: 'bolsa', name: 'Bolsa' })).toBe(0.1);
    expect(convertQty(300, 'gr', { abbr: 'horma', name: 'horma' })).toBeUndefined();
  });

  it('vincula por código, convierte y omite recetas con insumos sin resolver', async () => {
    const t = '2026-10-09T00:00:00Z';
    const base = { stock: 0, minStock: 0, maxStock: 0, purchaseFactor: 1, alternativeSupplierIds: [], active: true, createdAt: t, updatedAt: t };
    await db.units.bulkAdd([
      { id: 'kg', name: 'Kilogramo', abbreviation: 'kg', createdAt: t, updatedAt: t },
      { id: 'u', name: 'Unidad', abbreviation: 'u', createdAt: t, updatedAt: t },
      { id: 'h', name: 'horma', abbreviation: 'horma', createdAt: t, updatedAt: t },
    ] as never);
    await db.products.bulkAdd([
      { ...base, id: 'med', sku: '5121', name: 'Medialunas R', unitId: 'u' },
      { ...base, id: 'har', sku: '5089', name: 'Harina R', unitId: 'kg' },
      { ...base, id: 'pan', sku: '5113', name: 'Pan R', unitId: 'u' },
      { ...base, id: 'man', sku: '5094', name: 'Manteca R', unitId: 'h' },
    ] as never);
    const csv = [
      'codigo;nombre;porciones;unidad_med;cantidad;cod_ins;nombreins;neto1;envase1;medidains',
      '5121;Medialunas;72;ud;3000;5089;Harina 0000;25000;bols;gr',
      '5113;Pan de molde;5;ud;2400;5089;Harina 0000;25000;bols;gr',
      '5113;Pan de molde;5;ud;160;5094;Manteca;2500;paq;gr',
      '9999;No existe;1;ud;1;5089;Harina;0;;gr',
    ].join('\n');
    const plan = await planRecipeImport(parseCsv(csv));
    expect(plan.recipes.map((r) => [r.product.id, r.recipe.yield, r.recipe.items])).toEqual([['med', 72, [{ productId: 'har', quantity: 3 }]]]);
    expect(plan.issues.map((i) => i.product)).toEqual(['Pan R', 'No existe']);
    await plan.run();
    expect((await db.products.get('med'))!.recipe).toEqual({ yield: 72, items: [{ productId: 'har', quantity: 3 }] });
    expect((await db.products.get('pan'))!.recipe).toBeUndefined();
  });
});

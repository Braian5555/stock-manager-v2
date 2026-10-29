import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { familyZeroPreview, undoFamilyZero, zeroFamilyStock } from '../../src/services/familyZeroService';
import { emptyProduct, saveProduct } from '../../src/services/productService';

describe('poner en 0 una familia', () => {
  it('deja el stock en 0 con ajustes, sin tocar recetas ni otras familias, y se puede deshacer', async () => {
    await db.categories.bulkAdd([{ id: 'pan', name: 'Panaderia' }, { id: 'beb', name: 'Bebidas' }] as never);
    const harina = await saveProduct({ ...emptyProduct(), name: 'Harina', categoryId: 'beb' }, 20);
    const medialuna = await saveProduct({ ...emptyProduct(), name: 'Medialuna', categoryId: 'pan', recipe: { yield: 12, items: [{ productId: harina.id, quantity: 1 }] } }, 30);
    await saveProduct({ ...emptyProduct(), name: 'Pan', categoryId: 'pan' }, 4);
    await saveProduct({ ...emptyProduct(), name: 'Factura', categoryId: 'pan' }, 0);

    const pre = await familyZeroPreview('pan');
    expect(pre).toMatchObject({ family: 'Panaderia', products: 3, withStockAndRecipe: 1 });
    expect(pre.withStock.map((p) => p.name)).toEqual(['Medialuna', 'Pan']);

    // Sin los que tienen receta: sólo el pan.
    const onlyPan = await zeroFamilyStock('pan', { skipWithRecipe: true });
    expect(onlyPan.map((m) => m.productName)).toEqual(['Pan']);
    expect((await db.products.get(medialuna.id))!.stock).toBe(30);

    const moves = await zeroFamilyStock('pan');
    expect(moves.map((m) => [m.productName, m.type, m.quantityAfter, m.reason])).toEqual([['Medialuna', 'ajuste', 0, 'Puesta en cero: Panaderia']]);
    expect((await db.products.get(medialuna.id))!.recipe?.items).toHaveLength(1);
    expect((await db.products.get(harina.id))!.stock).toBe(20);

    await undoFamilyZero(moves);
    expect((await db.products.get(medialuna.id))!.stock).toBe(30);
  });
});

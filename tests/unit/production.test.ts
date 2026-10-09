import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { registerProduction, undoProduction } from '../../src/services/productionService';

describe('producción con receta', () => {
  it('suma lo producido, descuenta los insumos en proporción y el deshacer devuelve todo', async () => {
    const harina = await saveProduct({ ...emptyProduct(), name: 'Harina P' }, 10);
    const manteca = await saveProduct({ ...emptyProduct(), name: 'Manteca P' }, 5);
    // Tanda: 2 kg harina + 0,5 kg manteca → 24 medialunas
    const medialunas = await saveProduct({ ...emptyProduct(), name: 'Medialunas P', recipe: { yield: 24, items: [{ productId: harina.id, quantity: 2 }, { productId: manteca.id, quantity: 0.5 }] } });

    const r = await registerProduction(medialunas.id, 36);
    expect(r.consumed.map((c) => [c.name, c.quantity])).toEqual([['Harina P', 3], ['Manteca P', 0.75]]);
    expect((await db.products.get(medialunas.id))!.stock).toBe(36);
    expect((await db.products.get(harina.id))!.stock).toBe(7);
    expect((await db.products.get(manteca.id))!.stock).toBe(4.25);
    const consumos = await db.movements.where('refId').equals(r.movement.id).toArray();
    expect(consumos.every((m) => m.type === 'consumo')).toBe(true);

    await undoProduction(r.movement);
    expect((await db.products.get(medialunas.id))!.stock).toBe(0);
    expect((await db.products.get(harina.id))!.stock).toBe(10);
    expect((await db.products.get(manteca.id))!.stock).toBe(5);
    // Deshacer dos veces no devuelve de más.
    await undoProduction(r.movement);
    expect((await db.products.get(harina.id))!.stock).toBe(10);
  });

  it('sin receta sólo suma el producto', async () => {
    const pan = await saveProduct({ ...emptyProduct(), name: 'Pan P' });
    const r = await registerProduction(pan.id, 5);
    expect(r.consumed).toEqual([]);
    expect((await db.products.get(pan.id))!.stock).toBe(5);
  });
});

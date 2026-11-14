import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { deleteBlockers, deleteProduct, emptyProduct, saveProduct, zeroOutletsAndDelete } from '../../src/services/productService';
import { applyMovement } from '../../src/services/stockService';
import { saveOutlet } from '../../src/services/transferService';

describe('eliminar un producto que todavía tiene stock en un punto', () => {
  it('lo pone en 0 en el punto (queda el ajuste) y lo elimina', async () => {
    const conf = await saveOutlet({ name: 'Confitería', ptoVta: 4, active: true });
    const p = await saveProduct({ ...emptyProduct(), name: 'Fernet Branca (abierto)' }, 0);
    await applyMovement({ productId: p.id, type: 'conteo', newQuantity: 2, origin: 'conteo', outletId: conf.id });

    await expect(deleteProduct(p.id)).rejects.toThrow(/stock en algún punto/);
    expect(await deleteBlockers(p.id)).toEqual({ outlets: [{ id: conf.id, name: 'Confitería', qty: 2 }], inTransfer: false });

    await zeroOutletsAndDelete(p.id);
    expect(await db.products.get(p.id)).toBeUndefined();
    const adj = (await db.movements.where('productId').equals(p.id).toArray()).find((m) => m.type === 'ajuste');
    expect(adj).toMatchObject({ outletId: conf.id, quantityBefore: 2, quantityAfter: 0 });
  });
});

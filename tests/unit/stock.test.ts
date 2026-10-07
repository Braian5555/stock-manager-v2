import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { saveProduct, emptyProduct, duplicateProduct, deleteProduct } from '../../src/services/productService';
import { applyMovement, revertMovement, stockStatus } from '../../src/services/stockService';
import { ensureBaseData } from '../../src/services/seedService';
import { deleteCatalogItem } from '../../src/services/entityService';

describe('estado de stock', () => {
  it('clasifica normal / bajo / crítico / sin stock', () => {
    expect(stockStatus({ stock: 0, minStock: 10 })).toBe('sin_stock');
    expect(stockStatus({ stock: 5, minStock: 10 })).toBe('critico');
    expect(stockStatus({ stock: 8, minStock: 10 })).toBe('bajo');
    expect(stockStatus({ stock: 10, minStock: 10 })).toBe('bajo');
    expect(stockStatus({ stock: 11, minStock: 10 })).toBe('normal');
    expect(stockStatus({ stock: 3, minStock: 0 })).toBe('normal');
  });
});

describe('productos y movimientos', () => {
  it('crea un producto con stock inicial registrando un movimiento', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Producto A', minStock: 5 }, 12);
    expect(p.stock).toBe(12);
    const movs = await db.movements.where('productId').equals(p.id).toArray();
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ type: 'ingreso', quantityBefore: 0, quantityAfter: 12, delta: 12 });
  });

  it('aplica movimientos con anterior/nuevo/diferencia y es idempotente', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Hielo 10 kg' }, 5);
    const r1 = await applyMovement({ productId: p.id, type: 'ingreso', delta: 10, origin: 'manual', idempotencyKey: 'k1' });
    const r2 = await applyMovement({ productId: p.id, type: 'ingreso', delta: 10, origin: 'manual', idempotencyKey: 'k1' });
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);
    expect((await db.products.get(p.id))!.stock).toBe(15);
    expect(r1.movement).toMatchObject({ quantityBefore: 5, quantityAfter: 15, delta: 10 });
  });

  it('deshacer revierte con un ajuste inverso', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'X' }, 20);
    const { movement } = await applyMovement({ productId: p.id, type: 'perdida', delta: -3, origin: 'manual' });
    await revertMovement(movement);
    await revertMovement(movement); // segunda vez no hace nada
    expect((await db.products.get(p.id))!.stock).toBe(20);
  });

  it('editar un producto no cambia su stock', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Y' }, 7);
    await saveProduct({ ...p, name: 'Y2', stock: 999 });
    expect((await db.products.get(p.id))!).toMatchObject({ name: 'Y2', stock: 7 });
  });

  it('duplica sin stock ni vínculo externo, y elimina con deshacer', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Z', sku: 'Z1', externalSystems: { maxirest: { id: 'I1' } } }, 4);
    const copy = await duplicateProduct(p.id);
    expect(copy).toMatchObject({ name: 'Z (copia)', stock: 0, externalSystems: undefined });
    const undo = await deleteProduct(p.id);
    expect(await db.products.get(p.id)).toBeUndefined();
    await undo.restore();
    expect((await db.products.get(p.id))!.stock).toBe(4);
  });

  it('eliminar una familia deja los productos sin familia y se puede deshacer', async () => {
    await ensureBaseData();
    const cat = (await db.categories.toArray())[0];
    const p = await saveProduct({ ...emptyProduct(), name: 'P', categoryId: cat.id });
    const undo = await deleteCatalogItem('category', cat.id);
    expect((await db.products.get(p.id))!.categoryId).toBeUndefined();
    await undo.restore();
    expect((await db.products.get(p.id))!.categoryId).toBe(cat.id);
    expect(await db.categories.get(cat.id)).toBeDefined();
  });
});

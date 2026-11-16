import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { applyMovement, outletStockOf, revertMovement, setNegativeStockAllowed } from '../../src/services/stockService';
import { createTransfer, saveOutlet } from '../../src/services/transferService';

async function product(name: string, stock: number) {
  const p = await saveProduct({ ...emptyProduct(), name });
  if (stock) await applyMovement({ productId: p.id, type: 'ingreso', delta: stock, origin: 'manual' });
  return p.id;
}

describe('sin stock negativo (como viene la app)', () => {
  beforeEach(() => setNegativeStockAllowed(false));
  afterEach(() => setNegativeStockAllowed(true));

  it('una salida que no alcanza deja el stock en 0 y anota cuánto faltaba; deshacer vuelve exacto', async () => {
    const aceite = await product('Aceite', 3);
    const { movement } = await applyMovement({ productId: aceite, type: 'consumo', delta: -5, reason: 'Producción de Focaccia', origin: 'manual' });
    expect((await db.products.get(aceite))!.stock).toBe(0);
    expect(movement.delta).toBe(-3);
    expect(movement.reason).toBe('Producción de Focaccia · no alcanzaba: faltaban 2');
    // Ya en 0: otra salida no lo baja.
    await applyMovement({ productId: aceite, type: 'salida', delta: -1, origin: 'manual' });
    expect((await db.products.get(aceite))!.stock).toBe(0);
    // Un ingreso suma normal y deshacer la primera salida devuelve lo que restó de verdad.
    await applyMovement({ productId: aceite, type: 'ingreso', delta: 10, origin: 'manual' });
    await revertMovement(movement);
    expect((await db.products.get(aceite))!.stock).toBe(13);
  });

  it('a un punto sólo se manda lo que hay en el Depósito Central: sale de ahí y se suma en el punto', async () => {
    const coca = await product('Coca-Cola', 10);
    const chiringuito = await saveOutlet({ name: 'Chiringuito', active: true });
    await expect(createTransfer({ date: '2026-11-15', outletId: chiringuito.id, items: [{ productId: coca, quantity: 12 }] })).rejects.toThrow(/No alcanza el stock del Depósito Central: Coca-Cola \(hay 10\)/);
    expect((await db.products.get(coca))!.stock).toBe(10);
    expect(await db.transfers.count()).toBe(0);

    const { transfer } = await createTransfer({ date: '2026-11-15', outletId: chiringuito.id, items: [{ productId: coca, quantity: 10 }] });
    expect(transfer.maxirest).toBe('no_aplica'); // Maxirest apagado: no queda pendiente de cargar allá
    expect((await db.products.get(coca))!.stock).toBe(0);
    expect(await outletStockOf(chiringuito.id, coca)).toBe(10);
  });
});

describe('familias de los puntos', () => {
  it('sin elegir, un punto cuenta las bebidas con y sin alcohol y los vinos', async () => {
    const { outletCategoryIds } = await import('../../src/services/transferService');
    const cats = [
      { id: 'a', name: 'Bebidas sin alcohol' },
      { id: 'b', name: 'Bebidas con alcohol' },
      { id: 'c', name: 'Vinos y espumantes' },
      { id: 'd', name: 'Almacén' },
    ];
    expect(outletCategoryIds(undefined, cats)).toEqual(['a', 'b', 'c']);
    expect(outletCategoryIds({ categoryIds: ['d'] }, cats)).toEqual(['d']);
  });
});

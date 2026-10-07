import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { applyMovement, outletStockOf, recomputeStock, stockByOutlet } from '../../src/services/stockService';
import {
  createTransfer, deleteOutlet, maxirestRows, normalizeItems, saveOutlet, setMaxirestLoaded, transferCode, voidTransfer,
} from '../../src/services/transferService';
import { applyCount, setCounted, startCount } from '../../src/services/countService';

async function product(name: string, stock: number) {
  const p = await saveProduct({ ...emptyProduct(), name });
  if (stock) await applyMovement({ productId: p.id, type: 'ingreso', delta: stock, origin: 'manual' });
  return p.id;
}

describe('remitos internos', () => {
  it('resta del depósito, suma al punto y queda pendiente en Maxirest', async () => {
    const harina = await product('Harina', 50);
    const aceite = await product('Aceite', 10);
    const parador = await saveOutlet({ name: 'Parador', maxirestName: 'DEP PARADOR', active: true });
    const { transfer, negative } = await createTransfer({
      date: '2026-10-07', outletId: parador.id,
      items: [{ productId: harina, quantity: 5 }, { productId: harina, quantity: 3 }, { productId: aceite, quantity: 12 }, { productId: aceite, quantity: 0 }],
    });
    expect(transferCode(transfer.number)).toBe('R-0001');
    expect(transfer.items).toEqual([{ productId: harina, quantity: 8 }, { productId: aceite, quantity: 12 }]);
    expect(transfer.maxirest).toBe('pendiente');
    expect((await db.products.get(harina))!.stock).toBe(42);
    expect((await db.products.get(aceite))!.stock).toBe(-2);
    expect(negative).toEqual([aceite]);
    expect(await outletStockOf(parador.id, harina)).toBe(8);

    // El stock del depósito recalculado desde el historial ignora los movimientos del punto.
    await db.transaction('rw', db.products, db.movements, () => recomputeStock(harina));
    expect((await db.products.get(harina))!.stock).toBe(42);

    // Segundo remito → número correlativo y stock acumulado en el punto
    const r2 = await createTransfer({ date: '2026-10-08', outletId: parador.id, items: [{ productId: harina, quantity: 2 }] });
    expect(r2.transfer.number).toBe(2);
    expect(stockByOutlet(await db.movements.toArray()).get(parador.id)!.get(harina)).toBe(10);
  });

  it('anular devuelve la mercadería; si ya estaba cargado en Maxirest, queda pendiente de revertir', async () => {
    const queso = await product('Queso', 20);
    const xenote = await saveOutlet({ name: 'Xenote', active: true });
    const { transfer } = await createTransfer({ date: '2026-10-07', outletId: xenote.id, items: [{ productId: queso, quantity: 4 }] });
    expect(await setMaxirestLoaded([transfer.id], true)).toBe(1);
    const voided = await voidTransfer(transfer.id);
    expect(voided.status).toBe('anulado');
    expect(voided.maxirest).toBe('pendiente');
    expect((await db.products.get(queso))!.stock).toBe(20);
    expect(await outletStockOf(xenote.id, queso)).toBe(0);
    await voidTransfer(transfer.id); // idempotente
    expect((await db.products.get(queso))!.stock).toBe(20);

    const rows = await maxirestRows([voided]);
    expect(rows[0].slice(1, 5)).toEqual(['R-0001', 'Anulación', 'Xenote', 'Depósito Central']);

    // Anulado antes de cargarlo: no va a Maxirest
    const { transfer: t2 } = await createTransfer({ date: '2026-10-07', outletId: xenote.id, items: [{ productId: queso, quantity: 1 }] });
    expect((await voidTransfer(t2.id)).maxirest).toBe('no_aplica');
  });

  it('Excel para Maxirest: una fila por insumo con nombre de depósito y código', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Tomate', externalSystems: { maxirest: { id: 'X1', code: '1050' } } });
    await applyMovement({ productId: p.id, type: 'ingreso', delta: 10, origin: 'manual' });
    const o = await saveOutlet({ name: 'Confitería', maxirestName: 'CONFITERIA', active: true });
    const { transfer } = await createTransfer({ date: '2026-10-07', outletId: o.id, items: [{ productId: p.id, quantity: 2.5 }] });
    expect(await maxirestRows([transfer])).toEqual([['07/10/2026', 'R-0001', 'Transferencia', 'Depósito Central', 'CONFITERIA', '1050', 'Tomate', 2.5, '']]);
  });

  it('valida punto, productos y nombres; no borra puntos con historia', async () => {
    const p = await product('Sal', 5);
    await expect(createTransfer({ date: '2026-10-07', outletId: 'nope', items: [{ productId: p, quantity: 1 }] })).rejects.toThrow(/punto/);
    const o = await saveOutlet({ name: 'Quiosco', active: true });
    await expect(saveOutlet({ name: 'quiosco', active: true })).rejects.toThrow(/Ya existe/);
    await expect(createTransfer({ date: '2026-10-07', outletId: o.id, items: [] })).rejects.toThrow(/al menos un producto/);
    await createTransfer({ date: '2026-10-07', outletId: o.id, items: [{ productId: p, quantity: 1 }] });
    await expect(deleteOutlet(o.id)).rejects.toThrow(/desactivalo/);
    const off = await saveOutlet({ id: o.id, name: 'Quiosco', active: false });
    await expect(createTransfer({ date: '2026-10-07', outletId: off.id, items: [{ productId: p, quantity: 1 }] })).rejects.toThrow(/desactivado/);
    expect(normalizeItems([{ productId: '', quantity: 3 }])).toEqual([]);
  });

  it('conteo en un punto ajusta sólo el stock del punto', async () => {
    const leche = await product('Leche', 30);
    const o = await saveOutlet({ name: 'Churrería', active: true });
    await createTransfer({ date: '2026-10-07', outletId: o.id, items: [{ productId: leche, quantity: 12 }] });
    const count = await startCount({ outletId: o.id });
    const items = await db.countItems.where('countId').equals(count.id).toArray();
    expect(items).toHaveLength(1);
    expect(items[0].expected).toBe(12);
    await setCounted(items[0].id, 7);
    expect(await applyCount(count.id)).toBe(1);
    expect(await outletStockOf(o.id, leche)).toBe(7);
    expect((await db.products.get(leche))!.stock).toBe(18);

    const empty = await saveOutlet({ name: 'Nuevo', active: true });
    await expect(startCount({ outletId: empty.id })).rejects.toThrow(/todavía no recibió/);
  });
});

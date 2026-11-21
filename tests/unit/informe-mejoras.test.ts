/**
 * Arreglos del informe "errores y mejoras" (21/11): familias de los puntos al mandar mercadería,
 * facturas a mano y a un punto, número repetido, motivo corregible, ingresos repetidos,
 * producción de varios productos juntos y CUIT de proveedores.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import type { InvoiceItem } from '../../src/models';
import { saveEntity } from '../../src/services/entityService';
import { sameNumberInvoice, saveInvoice } from '../../src/services/invoiceService';
import { applyInvoiceToStock, undoInvoiceStock } from '../../src/services/invoiceStock';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { registerProductionBatch, undoProduction } from '../../src/services/productionService';
import { applyMovement, editMovementReason, outletStockOf, similarRecentIngresos } from '../../src/services/stockService';
import { createTransfer, missingFamilies, saveOutlet, setOutletCategories } from '../../src/services/transferService';
import { fmtCuit, validCuit } from '../../src/utils/cuit';

async function family(name: string) {
  return (await saveEntity(db.categories, { name })).id;
}
async function product(name: string, categoryId?: string, stock = 0) {
  const p = await saveProduct({ ...emptyProduct(), name, categoryId });
  if (stock) await applyMovement({ productId: p.id, type: 'ingreso', delta: stock, origin: 'manual' });
  return p;
}
const line = (description: string, extra: Partial<InvoiceItem> = {}): InvoiceItem => ({ id: crypto.randomUUID(), description, quantity: 1, status: 'ok', ...extra });

describe('informe de errores y mejoras', () => {
  it('un remito suma al punto las familias que no contaba (así lo que llega se ve y se cuenta)', async () => {
    const bebidas = await family('Bebidas sin alcohol');
    const panaderia = await family('Panadería');
    const coca = await product('Coca-Cola', bebidas, 10);
    const medialunas = await product('Medialunas', panaderia, 100);
    const confi = await saveOutlet({ name: 'Confitería', active: true });
    await setOutletCategories(confi.id, [bebidas]);

    const cats = await db.categories.toArray();
    expect(missingFamilies(await db.outlets.get(confi.id), cats, [coca, medialunas], [coca.id, medialunas.id]).map((c) => c.name)).toEqual(['Panadería']);

    const r = await createTransfer({ date: '2026-11-21', outletId: confi.id, items: [{ productId: coca.id, quantity: 2 }, { productId: medialunas.id, quantity: 24 }] });
    expect(r.addedFamilies).toEqual(['Panadería']);
    expect((await db.outlets.get(confi.id))!.categoryIds).toEqual([bebidas, panaderia]);

    // La segunda vez ya no hay nada que sumar.
    const again = await createTransfer({ date: '2026-11-21', outletId: confi.id, items: [{ productId: medialunas.id, quantity: 1 }] });
    expect(again.addedFamilies).toEqual([]);
  });

  it('una factura se puede cargar a mano (sin foto ni IA) y directo a un punto', async () => {
    const verduras = await family('Verduras');
    const tomate = await product('Tomate', verduras);
    const confi = await saveOutlet({ name: 'Confitería', active: true });
    await setOutletCategories(confi.id, []);

    await expect(saveInvoice({ date: '2026-11-21', pages: [] })).rejects.toThrow(/foto/);
    await expect(saveInvoice({ date: '2026-11-21', pages: [], items: [line('FLETE', { status: 'ignored' })] })).rejects.toThrow(/a mano/);

    const inv = await saveInvoice({ date: '2026-11-21', number: 'B 0001-00000077', outletId: confi.id, pages: [], items: [line('Tomate', { productId: tomate.id, quantity: 5, stockQty: 5, manual: true })] });
    expect(inv.outletId).toBe(confi.id);
    await applyInvoiceToStock(inv.id);
    expect(await outletStockOf(confi.id, tomate.id)).toBe(5);
    expect((await db.products.get(tomate.id))!.stock).toBe(0); // el Depósito Central no se toca
    expect((await db.outlets.get(confi.id))!.categoryIds).toEqual([verduras]);
    const mv = (await db.movements.where('refId').equals(inv.id).toArray())[0];
    expect(mv.reason).toBe('Factura B 0001-00000077 → Confitería');

    await undoInvoiceStock(inv.id);
    expect(await outletStockOf(confi.id, tomate.id)).toBe(0);

    // Ya cargada, el punto no cambia al editarla.
    await applyInvoiceToStock(inv.id);
    const edited = await saveInvoice({ id: inv.id, date: inv.date, pages: [], outletId: '', items: inv.items });
    expect(edited.outletId).toBe(confi.id);
  });

  it('avisa si el mismo proveedor ya tiene una factura con ese número', async () => {
    const sup = (await saveEntity(db.suppliers, { name: 'La Granja' })).id;
    const p = { id: 'pg', image: { type: 'image/jpeg' as const, data: 'QUJD', thumb: 'data:image/jpeg;base64,QUJD', width: 1, height: 1, bytes: 3 } };
    const a = await saveInvoice({ date: '2026-11-19', supplierId: sup, number: '0004-00004595', pages: [p] });
    expect((await sameNumberInvoice({ supplierId: sup, number: '4-4595' }))?.id).toBe(a.id);
    expect(await sameNumberInvoice({ supplierId: sup, number: '0004 00004596' })).toBeUndefined();
    expect(await sameNumberInvoice({ id: a.id, supplierId: sup, number: '0004-00004595' })).toBeUndefined();
    expect(await sameNumberInvoice({ supplierId: undefined, number: '0004-00004595' })).toBeUndefined();
    expect(await sameNumberInvoice({ supplierId: sup, number: '' })).toBeUndefined();
  });

  it('el motivo de un movimiento se corrige sin tocar el stock', async () => {
    const pizza = await product('Pizza', undefined, 0);
    const { movement } = await applyMovement({ productId: pizza.id, type: 'ingreso', delta: 120, origin: 'manual', reason: 'Ingreso 20/11' });
    const fixed = await editMovementReason(movement.id, 'Producción panadería 20/11');
    expect(fixed).toMatchObject({ reason: 'Producción panadería 20/11', originalReason: 'Ingreso 20/11', delta: 120, createdAt: movement.createdAt });
    expect(fixed.updatedAt >= movement.updatedAt).toBe(true);
    // Una segunda corrección conserva el motivo original.
    expect((await editMovementReason(movement.id, 'Producción 20/11')).originalReason).toBe('Ingreso 20/11');
    expect((await db.products.get(pizza.id))!.stock).toBe(120);
    await expect(editMovementReason('nada', 'x')).rejects.toThrow(/no existe/);
  });

  it('detecta un ingreso que parece repetido (misma cantidad, mismo lugar, últimos 3 días)', async () => {
    const aceite = await product('Aceite 10 L');
    const confi = await saveOutlet({ name: 'Confitería', active: true });
    await applyMovement({ productId: aceite.id, type: 'ingreso', delta: 18, origin: 'manual' });
    expect(await similarRecentIngresos(aceite.id, undefined, 18)).toHaveLength(1);
    expect(await similarRecentIngresos(aceite.id, undefined, 5)).toHaveLength(0); // otra cantidad
    expect(await similarRecentIngresos(aceite.id, undefined, 18, Date.now() + 2 * 86_400_000)).toHaveLength(1);
    expect(await similarRecentIngresos(aceite.id, undefined, 18, Date.now() + 4 * 86_400_000)).toHaveLength(0);
    expect(await similarRecentIngresos(aceite.id, confi.id, 18)).toHaveLength(0); // otro lugar
  });

  it('anota varias producciones juntas con un mismo motivo, todo o nada', async () => {
    const med = await product('Medialunas');
    const chipa = await product('Chipá');
    const r = await registerProductionBatch([{ productId: med.id, quantity: 74 }, { productId: chipa.id, quantity: 366 }, { productId: med.id, quantity: 1 }, { productId: chipa.id, quantity: 0 }], 'Producción 20/11');
    expect(r.movements).toHaveLength(2);
    expect((await db.products.get(med.id))!.stock).toBe(75);
    expect(r.movements.every((m) => m.reason === 'Producción 20/11' && m.type === 'produccion')).toBe(true);
    await expect(registerProductionBatch([{ productId: med.id, quantity: 0 }])).rejects.toThrow(/al menos un producto/);
    // Si un producto no existe, no queda nada cargado.
    await expect(registerProductionBatch([{ productId: chipa.id, quantity: 10 }, { productId: 'borrado', quantity: 1 }])).rejects.toThrow();
    expect((await db.products.get(chipa.id))!.stock).toBe(366);
    for (const m of r.movements) await undoProduction(m);
    expect((await db.products.get(med.id))!.stock).toBe(0);
  });

  it('valida y formatea el CUIT', () => {
    expect(validCuit('20-12345678-6')).toBe(true);
    expect(validCuit('20123456780')).toBe(false);
    expect(validCuit('123')).toBe(false);
    expect(fmtCuit('20123456786')).toBe('20-12345678-6');
  });
});

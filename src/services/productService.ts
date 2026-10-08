import { db } from '../database/db';
import type { Product } from '../models';
import { nowIso, uuid } from '../utils/id';
import { saveEntity, type Draft, type UndoSnapshot } from './entityService';
import { applyMovement, recomputeStock, stockByOutlet } from './stockService';

export function emptyProduct(): Draft<Product> {
  return {
    name: '',
    sku: '',
    purchaseFactor: 1,
    alternativeSupplierIds: [],
    stock: 0,
    minStock: 0,
    maxStock: 0,
    active: true,
  };
}

/**
 * Guarda un producto. En altas, el stock inicial se registra como movimiento de "ingreso"
 * para que el historial sea completo. En ediciones el stock NO se toca desde aquí
 * (los cambios de stock siempre generan un movimiento explícito).
 */
export async function saveProduct(draft: Draft<Product>, initialStock = 0): Promise<Product> {
  if (!Number.isFinite(initialStock) || initialStock < 0) throw new Error('El stock inicial no puede ser negativo.');
  const clean: Draft<Product> = {
    ...draft,
    name: draft.name.trim(),
    sku: draft.sku?.trim() || undefined,
    purchaseFactor: draft.purchaseFactor > 0 ? draft.purchaseFactor : 1,
    minStock: Math.max(0, draft.minStock || 0),
    maxStock: Math.max(0, draft.maxStock || 0),
    alternativeSupplierIds: (draft.alternativeSupplierIds ?? []).filter((s) => s && s !== draft.supplierId),
  };
  if (!clean.name) throw new Error('El nombre es obligatorio.');
  if (draft.id) {
    const prev = await db.products.get(draft.id);
    return saveEntity(db.products, { ...clean, stock: prev?.stock ?? clean.stock });
  }
  const created = await saveEntity(db.products, { ...clean, stock: 0 });
  if (initialStock) {
    await applyMovement({
      productId: created.id,
      type: 'ingreso',
      newQuantity: initialStock,
      reason: 'Stock inicial',
      origin: 'alta',
      idempotencyKey: `initial:${created.id}`,
    });
  }
  return (await db.products.get(created.id))!;
}

/** Duplica un producto (sin stock ni vínculos externos). */
export async function duplicateProduct(id: string): Promise<Product> {
  const p = await db.products.get(id);
  if (!p) throw new Error('El producto no existe.');
  const t = nowIso();
  const copy: Product = {
    ...p,
    id: uuid(),
    name: `${p.name} (copia)`,
    sku: p.sku ? `${p.sku}-COPIA` : undefined,
    stock: 0,
    externalSystems: undefined,
    createdAt: t,
    updatedAt: t,
  };
  await db.products.add(copy);
  return copy;
}

/**
 * Elimina el producto. Su historial de movimientos se conserva.
 * No se puede eliminar si tiene stock en algún punto o está en un remito vigente
 * (al anular ese remito no habría a qué producto devolverle la mercadería).
 */
export async function deleteProduct(id: string): Promise<UndoSnapshot> {
  const p = await db.products.get(id);
  if (!p) throw new Error('El producto no existe.');
  const atOutlets = [...stockByOutlet((await db.movements.where('productId').equals(id).toArray())).values()].some((m) => (m.get(id) ?? 0) !== 0);
  const inTransfers = (await db.transfers.where('status').equals('enviado').toArray()).some((t) => t.items.some((i) => i.productId === id));
  if (atOutlets || inTransfers)
    throw new Error('Este producto tiene stock en algún punto o está en un remito. Desactivalo en lugar de eliminarlo.');
  await db.products.delete(id);
  return {
    restore: async () => {
      await db.transaction('rw', db.products, db.movements, async () => {
        await db.products.put({ ...p, updatedAt: nowIso() });
        await recomputeStock(id); // pudieron llegar movimientos mientras estaba eliminado
      });
    },
  };
}

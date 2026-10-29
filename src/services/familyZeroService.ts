import { db } from '../database/db';
import type { Product, StockMovement } from '../models';
import { applyMovement, revertMovement } from './stockService';

/**
 * Poner en 0 el stock (Depósito Central) de los productos de una familia. No borra nada:
 * cada producto queda con un ajuste a 0 en Movimientos (se puede deshacer) y las recetas,
 * los planes y el resto de los datos del producto quedan igual.
 */

export interface FamilyZeroPreview {
  family: string;
  /** Productos activos de la familia. */
  products: number;
  /** Con stock distinto de 0 (los que cambiarían). */
  withStock: Product[];
  /** De esos, los que tienen receta (lo que se elabora). */
  withStockAndRecipe: number;
}

const hasRecipe = (p: Product) => !!p.recipe?.items.length;

export async function familyZeroPreview(categoryId: string): Promise<FamilyZeroPreview> {
  const [cat, products] = await Promise.all([db.categories.get(categoryId), db.products.where('categoryId').equals(categoryId).toArray()]);
  const active = products.filter((p) => p.active);
  const withStock = active.filter((p) => p.stock !== 0).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return { family: cat?.name ?? '', products: active.length, withStock, withStockAndRecipe: withStock.filter(hasRecipe).length };
}

export async function zeroFamilyStock(categoryId: string, opts: { skipWithRecipe?: boolean } = {}): Promise<StockMovement[]> {
  const { family, withStock } = await familyZeroPreview(categoryId);
  const done: StockMovement[] = [];
  for (const p of withStock) {
    if (opts.skipWithRecipe && hasRecipe(p)) continue;
    const { movement, duplicate } = await applyMovement({ productId: p.id, type: 'ajuste', newQuantity: 0, origin: 'manual', reason: `Puesta en cero: ${family}` });
    if (!duplicate) done.push(movement);
  }
  return done;
}

/** Deshace una puesta en cero: cada producto vuelve a lo que tenía (queda registrado). */
export async function undoFamilyZero(movements: StockMovement[]): Promise<void> {
  for (const m of movements) await revertMovement(m);
}

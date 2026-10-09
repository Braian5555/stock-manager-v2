import { db } from '../database/db';
import type { Product, StockMovement } from '../models';
import { round3 } from '../utils/format';
import { uuid } from '../utils/id';
import { applyMovement, revertMovement } from './stockService';

export interface ConsumptionLine {
  productId: string;
  name: string;
  quantity: number;
}

/** Insumos que se descuentan al producir `qty` del producto (según su receta). */
export function recipeConsumption(product: Pick<Product, 'recipe'>, qty: number, byId: Map<string, Pick<Product, 'name'>>): ConsumptionLine[] {
  const r = product.recipe;
  if (!r || !(r.yield > 0) || !(qty > 0)) return [];
  return r.items
    .filter((i) => i.quantity > 0 && byId.has(i.productId))
    .map((i) => ({ productId: i.productId, name: byId.get(i.productId)!.name, quantity: round3((i.quantity * qty) / r.yield) }));
}

/**
 * Anota una producción: suma `qty` al producto y, si tiene receta, descuenta sus insumos como
 * "Consumo" ligado a esta producción. Todo en una sola transacción: o queda todo o nada.
 */
export async function registerProduction(productId: string, qty: number): Promise<{ movement: StockMovement; consumed: ConsumptionLine[] }> {
  if (!(qty > 0)) throw new Error('Ingresá cuánto se produjo.');
  return db.transaction('rw', db.products, db.movements, async () => {
    const product = await db.products.get(productId);
    if (!product) throw new Error('El producto no existe.');
    const ids = (product.recipe?.items ?? []).map((i) => i.productId);
    const ingredients = (await db.products.bulkGet(ids)).filter((p): p is Product => !!p);
    const consumed = recipeConsumption(product, qty, new Map(ingredients.map((p) => [p.id, p])));
    const key = `prod:${uuid()}`;
    const { movement } = await applyMovement({ productId, type: 'produccion', delta: round3(qty), origin: 'manual', reason: 'Producción', idempotencyKey: key });
    for (const c of consumed) {
      if (c.productId === productId) continue;
      await applyMovement({
        productId: c.productId,
        type: 'consumo',
        delta: -c.quantity,
        origin: 'manual',
        reason: `Producción de ${product.name}`,
        refId: movement.id,
        idempotencyKey: `${key}:${c.productId}`,
      });
    }
    return { movement, consumed };
  });
}

/** Deshace una producción y devuelve los insumos que había descontado. */
export async function undoProduction(movement: StockMovement): Promise<void> {
  await db.transaction('rw', db.products, db.movements, async () => {
    const linked = (await db.movements.where('refId').equals(movement.id).toArray()).filter((m) => m.type === 'consumo');
    await revertMovement(movement);
    for (const m of linked) await revertMovement(m);
  });
}

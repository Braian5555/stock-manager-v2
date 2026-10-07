import { db } from '../database/db';
import type { CountBaseline, InventoryCount, InventoryCountItem } from '../models';
import { nowIso, uuid } from '../utils/id';
import { round3 } from '../utils/format';
import { applyMovement } from './stockService';

export interface StartCountInput {
  name?: string;
  locationId?: string;
  categoryId?: string;
  baseline?: CountBaseline;
}

/** Inicia un conteo con los productos activos que cumplen el filtro (ubicación / familia). */
export async function startCount(input: StartCountInput): Promise<InventoryCount> {
  return db.transaction('rw', [db.counts, db.countItems, db.products, db.externalReferences], async () => {
    const t = nowIso();
    const baseline = input.baseline ?? 'local';
    const products = (await db.products.toArray()).filter(
      (p) =>
        p.active &&
        (!input.locationId || p.locationId === input.locationId) &&
        (!input.categoryId || p.categoryId === input.categoryId),
    );
    const external =
      baseline === 'local'
        ? new Map<string, number | undefined>()
        : new Map(
            (await db.externalReferences.where({ system: baseline, entityType: 'product' }).toArray()).map((r) => [r.externalId, r.stock]),
          );
    const count: InventoryCount = {
      id: uuid(),
      createdAt: t,
      updatedAt: t,
      name: input.name?.trim() || `Conteo ${new Date().toLocaleDateString('es-AR')}`,
      status: 'abierto',
      locationId: input.locationId,
      categoryId: input.categoryId,
      baseline,
    };
    await db.counts.add(count);
    const items: InventoryCountItem[] = products.map((p) => {
      const extId = baseline === 'local' ? undefined : p.externalSystems?.[baseline]?.id;
      const extStock = extId ? external.get(extId) : undefined;
      return { id: uuid(), createdAt: t, updatedAt: t, countId: count.id, productId: p.id, expected: extStock ?? p.stock };
    });
    await db.countItems.bulkAdd(items);
    return count;
  });
}

export async function setCounted(itemId: string, counted: number | undefined): Promise<void> {
  const value = counted === undefined || Number.isNaN(counted) ? undefined : Math.max(0, round3(counted));
  await db.countItems.update(itemId, { counted: value, updatedAt: nowIso() });
}

export interface CountLine {
  item: InventoryCountItem;
  difference: number;
}

export interface CountSummary {
  total: number;
  counted: number;
  uncounted: number;
  increases: CountLine[];
  decreases: CountLine[];
  unchanged: CountLine[];
}

export function summarizeCount(items: InventoryCountItem[]): CountSummary {
  const s: CountSummary = { total: items.length, counted: 0, uncounted: 0, increases: [], decreases: [], unchanged: [] };
  for (const item of items) {
    if (item.counted === undefined) {
      s.uncounted++;
      continue;
    }
    s.counted++;
    const difference = round3(item.counted - item.expected);
    const line = { item, difference };
    if (difference > 0) s.increases.push(line);
    else if (difference < 0) s.decreases.push(line);
    else s.unchanged.push(line);
  }
  return s;
}

export async function finishCount(countId: string): Promise<void> {
  const t = nowIso();
  await db.counts.update(countId, { status: 'finalizado', finishedAt: t, updatedAt: t });
}

export async function reopenCount(countId: string): Promise<void> {
  await db.counts.update(countId, { status: 'abierto', finishedAt: undefined, updatedAt: nowIso() });
}

export async function discardCount(countId: string): Promise<void> {
  await db.counts.update(countId, { status: 'descartado', updatedAt: nowIso() });
}

/**
 * Aplica el conteo al stock LOCAL: cada producto contado queda con la cantidad contada.
 * Idempotente por (conteo, producto). Sólo se ejecuta tras confirmación del usuario.
 * Devuelve la cantidad de movimientos generados.
 */
export async function applyCount(countId: string): Promise<number> {
  const items = await db.countItems.where('countId').equals(countId).toArray();
  const count = await db.counts.get(countId);
  if (!count) throw new Error('El conteo no existe.');
  if (count.status === 'aplicado') return 0;
  let applied = 0;
  for (const item of items) {
    if (item.counted === undefined) continue;
    const product = await db.products.get(item.productId);
    if (!product || product.stock === item.counted) continue;
    const { duplicate } = await applyMovement({
      productId: item.productId,
      type: 'conteo',
      newQuantity: item.counted,
      reason: count.name,
      origin: 'conteo',
      refId: countId,
      idempotencyKey: `count:${countId}:${item.productId}`,
    });
    if (!duplicate) applied++;
  }
  const t = nowIso();
  await db.counts.update(countId, { status: 'aplicado', appliedAt: t, finishedAt: count.finishedAt ?? t, updatedAt: t });
  return applied;
}

import { db } from '../database/db';
import type { CountBaseline, InventoryCount, InventoryCountItem } from '../models';
import { nowIso, uuid } from '../utils/id';
import { round3 } from '../utils/format';
import { applyMovement, outletStockOf, stockByOutlet } from './stockService';
import { getCurrentActor } from './userService';

export interface StartCountInput {
  name?: string;
  locationId?: string;
  categoryId?: string;
  baseline?: CountBaseline;
  /** Contar el stock de un punto gastronómico en lugar del Depósito Central. */
  outletId?: string;
}

/** Inicia un conteo con los productos activos que cumplen el filtro (ubicación / familia). */
export async function startCount(input: StartCountInput): Promise<InventoryCount> {
  return db.transaction('rw', [db.counts, db.countItems, db.products, db.externalReferences, db.movements, db.outlets], async () => {
    const t = nowIso();
    const outlet = input.outletId ? await db.outlets.get(input.outletId) : undefined;
    if (input.outletId && !outlet) throw new Error('El punto no existe.');
    // En un punto se compara siempre contra el stock de la app (Maxirest no informa stock por punto acá).
    const baseline = outlet ? 'local' : (input.baseline ?? 'local');
    const atOutlet = outlet ? stockByOutlet(await db.movements.toArray()).get(outlet.id) ?? new Map<string, number>() : undefined;
    const products = (await db.products.toArray()).filter(
      (p) =>
        p.active &&
        (outlet ? atOutlet!.has(p.id) : !input.locationId || p.locationId === input.locationId) &&
        (!input.categoryId || p.categoryId === input.categoryId),
    );
    if (outlet && !products.length) throw new Error(`${outlet.name} todavía no recibió mercadería por remito.`);
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
      name: input.name?.trim() || `Conteo ${outlet ? `${outlet.name} ` : ''}${new Date().toLocaleDateString('es-AR')}`,
      status: 'abierto',
      locationId: outlet ? undefined : input.locationId,
      outletId: outlet?.id,
      categoryId: input.categoryId,
      baseline,
      createdBy: getCurrentActor(),
    };
    await db.counts.add(count);
    const items: InventoryCountItem[] = products.map((p) => {
      const extId = baseline === 'local' ? undefined : p.externalSystems?.[baseline]?.id;
      const extStock = extId ? external.get(extId) : undefined;
      return { id: uuid(), createdAt: t, updatedAt: t, countId: count.id, productId: p.id, expected: atOutlet ? (atOutlet.get(p.id) ?? 0) : (extStock ?? p.stock) };
    });
    await db.countItems.bulkAdd(items);
    return count;
  });
}

export async function setCounted(itemId: string, counted: number | undefined): Promise<void> {
  const value = counted === undefined || Number.isNaN(counted) ? undefined : Math.max(0, round3(counted));
  const t = nowIso();
  await db.countItems.update(itemId, value === undefined
    ? { counted: undefined, countedBy: undefined, countedAt: undefined, updatedAt: t }
    : { counted: value, countedBy: getCurrentActor(), countedAt: t, updatedAt: t });
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
  await db.counts.update(countId, { status: 'finalizado', finishedAt: t, finishedBy: getCurrentActor(), updatedAt: t });
}

export async function reopenCount(countId: string): Promise<void> {
  await db.counts.update(countId, { status: 'abierto', finishedAt: undefined, finishedBy: undefined, updatedAt: nowIso() });
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
    if (!product) continue;
    const current = count.outletId ? await outletStockOf(count.outletId, product.id) : product.stock;
    if (current === item.counted) continue;
    const { duplicate } = await applyMovement({
      productId: item.productId,
      type: 'conteo',
      newQuantity: item.counted,
      reason: count.name,
      origin: 'conteo',
      refId: countId,
      idempotencyKey: `count:${countId}:${item.productId}`,
      outletId: count.outletId,
    });
    if (!duplicate) applied++;
  }
  const t = nowIso();
  await db.counts.update(countId, { status: 'aplicado', appliedAt: t, appliedBy: getCurrentActor(), finishedAt: count.finishedAt ?? t, updatedAt: t });
  return applied;
}

/**
 * Productos contados cuyo stock cambió desde que empezó el conteo (ventas, ingresos…).
 * Al aplicar quedan en lo contado; se avisa antes para que nadie se sorprenda.
 */
export async function movedSinceStart(countId: string): Promise<{ productId: string; expected: number; current: number; counted: number }[]> {
  const count = await db.counts.get(countId);
  if (!count || count.baseline !== 'local') return [];
  const items = (await db.countItems.where('countId').equals(countId).toArray()).filter((i) => i.counted !== undefined);
  const out: { productId: string; expected: number; current: number; counted: number }[] = [];
  for (const i of items) {
    const p = await db.products.get(i.productId);
    if (!p) continue;
    const current = count.outletId ? await outletStockOf(count.outletId, p.id) : p.stock;
    if (round3(current) !== round3(i.expected)) out.push({ productId: p.id, expected: i.expected, current, counted: i.counted! });
  }
  return out;
}

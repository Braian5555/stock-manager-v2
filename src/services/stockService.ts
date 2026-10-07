import { db } from '../database/db';
import type { MovementOrigin, MovementType, Product, Settings, SourceSystem, StockMovement, StockStatus } from '../models';
import { nowIso, uuid } from '../utils/id';
import { round3 } from '../utils/format';
import { getCurrentActor } from './userService';

export const STATUS_LABEL: Record<StockStatus, string> = {
  normal: 'Normal',
  bajo: 'Stock bajo',
  critico: 'Crítico',
  sin_stock: 'Sin stock',
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  ingreso: 'Ingreso',
  salida: 'Salida',
  ajuste: 'Ajuste',
  conteo: 'Conteo',
  devolucion: 'Devolución',
  perdida: 'Pérdida',
  consumo: 'Consumo',
};

/** Tipos que restan stock cuando se cargan como cantidad positiva. */
export const OUTGOING_TYPES: MovementType[] = ['salida', 'perdida', 'consumo'];

/**
 * Estado del producto según su mínimo:
 * - Sin stock: stock <= 0
 * - Crítico:  stock <= mínimo × ratio crítico
 * - Bajo:     stock <= mínimo
 * Si el mínimo es 0 no hay alertas salvo "Sin stock".
 */
export function stockStatus(p: Pick<Product, 'stock' | 'minStock'>, criticalRatio = 0.5): StockStatus {
  if (p.stock <= 0) return 'sin_stock';
  if (p.minStock > 0 && p.stock <= p.minStock * criticalRatio) return 'critico';
  if (p.minStock > 0 && p.stock <= p.minStock) return 'bajo';
  return 'normal';
}

export const statusOf = (p: Product, s: Pick<Settings, 'criticalRatio'>) => stockStatus(p, s.criticalRatio);

export interface MovementInput {
  productId: string;
  type: MovementType;
  /** Cantidad final deseada (para ajustes y conteos) */
  newQuantity?: number;
  /** Variación (positiva o negativa) */
  delta?: number;
  reason?: string;
  origin: MovementOrigin;
  sourceSystem?: SourceSystem;
  /** Si se omite se genera una nueva; si ya existe, el movimiento NO se aplica otra vez. */
  idempotencyKey?: string;
  externalMovementId?: string;
  syncId?: string;
  refId?: string;
  /** Punto gastronómico (si falta, Depósito Central). */
  outletId?: string;
}

export interface MovementResult {
  movement: StockMovement;
  duplicate: boolean;
}

/**
 * Aplica un movimiento de stock de forma atómica e idempotente.
 * Debe llamarse dentro o fuera de una transacción de Dexie sobre products+movements.
 */
export async function applyMovement(input: MovementInput): Promise<MovementResult> {
  const key = input.idempotencyKey ?? `local:${uuid()}`;
  // Con clave determinística (pedido+ítem, conteo+producto…) el id también lo es:
  // si dos dispositivos registran el mismo hecho, en la nube queda un solo movimiento.
  const id = input.idempotencyKey ? movementIdForKey(input.idempotencyKey) : uuid();
  return db.transaction('rw', db.products, db.movements, async () => {
    const existing = await db.movements.where('idempotencyKey').equals(key).first();
    if (existing) return { movement: existing, duplicate: true };

    const product = await db.products.get(input.productId);
    if (!product) throw new Error('El producto no existe.');

    // Depósito Central: stock guardado en el producto. Punto: se calcula con sus movimientos.
    const before = input.outletId ? await outletStockOf(input.outletId, product.id) : product.stock;
    let after: number;
    if (input.newQuantity !== undefined) after = input.newQuantity;
    else if (input.delta !== undefined) after = before + input.delta;
    else throw new Error('Falta la cantidad del movimiento.');
    after = round3(after);
    if (!Number.isFinite(after)) throw new Error('Cantidad inválida.');

    const t = nowIso();
    const movement: StockMovement = {
      id,
      createdAt: t,
      updatedAt: t,
      productId: product.id,
      type: input.type,
      quantityBefore: before,
      quantityAfter: after,
      delta: round3(after - before),
      reason: input.reason?.trim() || undefined,
      origin: input.origin,
      sourceSystem: input.sourceSystem ?? 'local',
      idempotencyKey: key,
      externalMovementId: input.externalMovementId,
      syncId: input.syncId,
      refId: input.refId,
      absolute: input.newQuantity !== undefined && (input.type === 'ajuste' || input.type === 'conteo'),
      performedBy: getCurrentActor(),
      outletId: input.outletId || undefined,
    };
    await db.movements.add(movement);
    if (!movement.outletId) await db.products.update(product.id, { stock: after, updatedAt: t });
    return { movement, duplicate: false };
  });
}

/** Revierte un movimiento con un ajuste inverso (no borra historia). */
export async function revertMovement(movement: StockMovement): Promise<MovementResult> {
  return applyMovement({
    productId: movement.productId,
    type: 'ajuste',
    delta: -movement.delta,
    reason: 'Deshacer movimiento',
    origin: 'deshacer',
    idempotencyKey: `undo:${movement.id}`,
    outletId: movement.outletId,
  });
}

/** Id determinístico (FNV-1a de 64 bits en dos mitades) para una clave de idempotencia. */
export function movementIdForKey(key: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `m_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}_${key.length}`;
}

/** Orden total de movimientos: fecha y, ante empate, id. */
export const movementOrder = (a: StockMovement, b: StockMovement) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Stock resultante de aplicar los movimientos en orden: los absolutos fijan la cantidad,
 * el resto suma su diferencia. Si no hay movimientos devuelve undefined.
 */
export function foldStock(movements: StockMovement[]): number | undefined {
  if (!movements.length) return undefined;
  let stock = 0;
  for (const m of [...movements].sort(movementOrder)) stock = m.absolute ? m.quantityAfter : round3(stock + m.delta);
  return stock;
}

/**
 * Recalcula el stock de un producto a partir de su historial (se usa al recibir
 * movimientos de otros dispositivos). Debe llamarse dentro de una transacción rw
 * sobre products y movements.
 */
export async function recomputeStock(productId: string): Promise<void> {
  const product = await db.products.get(productId);
  if (!product) return;
  const stock = foldStock((await db.movements.where('productId').equals(productId).toArray()).filter((m) => !m.outletId));
  if (stock !== undefined && stock !== product.stock) await db.products.update(productId, { stock });
}

/** Stock de un producto en un punto gastronómico (0 si nunca recibió). */
export async function outletStockOf(outletId: string, productId: string): Promise<number> {
  const movs = (await db.movements.where('productId').equals(productId).toArray()).filter((m) => m.outletId === outletId);
  return foldStock(movs) ?? 0;
}

/** Stock de cada producto en cada punto: Map<outletId, Map<productId, cantidad>>. */
export function stockByOutlet(movements: StockMovement[]): Map<string, Map<string, number>> {
  const groups = new Map<string, StockMovement[]>();
  for (const m of movements) {
    if (!m.outletId) continue;
    const k = `${m.outletId}\u0000${m.productId}`;
    const g = groups.get(k);
    if (g) g.push(m);
    else groups.set(k, [m]);
  }
  const out = new Map<string, Map<string, number>>();
  for (const [k, list] of groups) {
    const [outletId, productId] = k.split('\u0000');
    if (!out.has(outletId)) out.set(outletId, new Map());
    out.get(outletId)!.set(productId, foldStock(list) ?? 0);
  }
  return out;
}

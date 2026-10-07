import { db } from '../database/db';
import type { MovementOrigin, MovementType, Product, Settings, SourceSystem, StockMovement, StockStatus } from '../models';
import { nowIso, uuid } from '../utils/id';
import { round3 } from '../utils/format';

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
  return db.transaction('rw', db.products, db.movements, async () => {
    const existing = await db.movements.where('idempotencyKey').equals(key).first();
    if (existing) return { movement: existing, duplicate: true };

    const product = await db.products.get(input.productId);
    if (!product) throw new Error('El producto no existe.');

    const before = product.stock;
    let after: number;
    if (input.newQuantity !== undefined) after = input.newQuantity;
    else if (input.delta !== undefined) after = before + input.delta;
    else throw new Error('Falta la cantidad del movimiento.');
    after = round3(after);
    if (!Number.isFinite(after)) throw new Error('Cantidad inválida.');

    const t = nowIso();
    const movement: StockMovement = {
      id: uuid(),
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
    };
    await db.movements.add(movement);
    await db.products.update(product.id, { stock: after, updatedAt: t });
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
  });
}

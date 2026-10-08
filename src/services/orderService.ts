import { db } from '../database/db';
import type { Order, OrderItem, OrderStatus, Product, Settings } from '../models';
import { nowIso, uuid } from '../utils/id';
import { round3 } from '../utils/format';
import type { UndoSnapshot } from './entityService';
import { applyMovement } from './stockService';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  borrador: 'Borrador',
  pendiente: 'Pendiente',
  enviado: 'Enviado',
  recibido: 'Recibido',
  cancelado: 'Cancelado',
};

/** Pedidos que todavía esperan mercadería. */
export const OPEN_ORDER_STATUSES: OrderStatus[] = ['pendiente', 'enviado'];

export interface OrderLineDraft {
  id?: string;
  productId: string;
  quantity: number;
  factor?: number;
}

export interface OrderDraft {
  id?: string;
  supplierId?: string;
  status: OrderStatus;
  date: string;
  notes?: string;
  items: OrderLineDraft[];
}

async function nextOrderNumber(): Promise<number> {
  const last = await db.orders.orderBy('number').last();
  return (last?.number ?? 0) + 1;
}

/** Crea o actualiza un pedido con sus ítems (reemplaza la lista de ítems). */
export async function saveOrder(draft: OrderDraft): Promise<Order> {
  return db.transaction('rw', db.orders, db.orderItems, db.products, async () => {
    const t = nowIso();
    let order: Order;
    if (draft.id) {
      const prev = await db.orders.get(draft.id);
      if (!prev) throw new Error('El pedido no existe.');
      if (prev.status === 'recibido') throw new Error('Un pedido recibido no se puede modificar.');
      order = { ...prev, supplierId: draft.supplierId, status: draft.status, date: draft.date, notes: draft.notes, updatedAt: t };
      await db.orders.put(order);
    } else {
      order = {
        id: uuid(),
        createdAt: t,
        updatedAt: t,
        number: await nextOrderNumber(),
        date: draft.date,
        supplierId: draft.supplierId,
        status: draft.status,
        notes: draft.notes,
      };
      await db.orders.add(order);
    }
    await db.orderItems.where('orderId').equals(order.id).delete();
    const items: OrderItem[] = [];
    for (const line of draft.items.filter((l) => l.productId && l.quantity > 0)) {
      const product = await db.products.get(line.productId);
      items.push({
        id: line.id ?? uuid(),
        createdAt: t,
        updatedAt: t,
        orderId: order.id,
        productId: line.productId,
        quantity: round3(line.quantity),
        factor: line.factor ?? product?.purchaseFactor ?? 1,
      });
    }
    await db.orderItems.bulkAdd(items);
    return order;
  });
}

export async function duplicateOrder(id: string): Promise<Order> {
  const order = await db.orders.get(id);
  if (!order) throw new Error('El pedido no existe.');
  const items = await db.orderItems.where('orderId').equals(id).toArray();
  return saveOrder({
    supplierId: order.supplierId,
    status: 'borrador',
    date: nowIso(),
    notes: order.notes,
    items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, factor: i.factor })),
  });
}

export async function deleteOrder(id: string): Promise<UndoSnapshot> {
  return db.transaction('rw', db.orders, db.orderItems, async () => {
    const order = await db.orders.get(id);
    if (!order) throw new Error('El pedido no existe.');
    const items = await db.orderItems.where('orderId').equals(id).toArray();
    await db.orderItems.where('orderId').equals(id).delete();
    await db.orders.delete(id);
    return {
      restore: async () => {
        await db.transaction('rw', db.orders, db.orderItems, async () => {
          await db.orders.put(order);
          await db.orderItems.bulkPut(items);
        });
      },
    };
  });
}

export async function setOrderStatus(id: string, status: Exclude<OrderStatus, 'recibido'>): Promise<void> {
  const order = await db.orders.get(id);
  if (!order) throw new Error('El pedido no existe.');
  if (order.status === 'recibido') throw new Error('El pedido ya fue recibido.');
  await db.orders.update(id, { status, updatedAt: nowIso() });
}

export interface ReceiveLine {
  itemId: string;
  /** Cantidad recibida en unidad de compra. */
  receivedQuantity: number;
}

export interface ReceiveSummary {
  lines: { productId: string; before: number; added: number; after: number }[];
}

/**
 * Recibe un pedido: suma al stock (cantidad × factor) y registra un movimiento de ingreso
 * por ítem. Cada ítem usa una clave idempotente, por lo que recibir dos veces no duplica stock.
 */
export async function receiveOrder(orderId: string, lines?: ReceiveLine[]): Promise<ReceiveSummary> {
  return db.transaction('rw', db.orders, db.orderItems, db.products, db.movements, async () => {
    const order = await db.orders.get(orderId);
    if (!order) throw new Error('El pedido no existe.');
    if (order.status === 'cancelado') throw new Error('No se puede recibir un pedido cancelado.');
    if (order.status === 'recibido') throw new Error('Este pedido ya fue recibido.');
    const items = await db.orderItems.where('orderId').equals(orderId).toArray();
    const summary: ReceiveSummary = { lines: [] };
    for (const item of items) {
      const received = lines?.find((l) => l.itemId === item.id)?.receivedQuantity ?? item.quantity;
      await db.orderItems.update(item.id, { receivedQuantity: received, updatedAt: nowIso() });
      if (received <= 0) continue;
      if (!(await db.products.get(item.productId))) continue;
      const { movement, duplicate } = await applyMovement({
        productId: item.productId,
        type: 'ingreso',
        delta: round3(received * item.factor),
        reason: `Pedido #${order.number}`,
        origin: 'pedido',
        refId: order.id,
        idempotencyKey: `order:${order.id}:item:${item.id}`,
      });
      if (!duplicate)
        summary.lines.push({ productId: item.productId, before: movement.quantityBefore, added: movement.delta, after: movement.quantityAfter });
    }
    const t = nowIso();
    await db.orders.update(orderId, { status: 'recibido', receivedAt: t, updatedAt: t });
    return summary;
  });
}

// ───────────────────────── Pedido sugerido ─────────────────────────

export interface SuggestedLine {
  product: Product;
  /** Faltante en unidad de stock */
  needed: number;
  /** Cantidad a pedir en unidad de compra */
  quantity: number;
}

export interface SuggestedGroup {
  supplierId?: string;
  lines: SuggestedLine[];
}

/**
 * Propone cantidades para los productos en o por debajo del mínimo.
 * - toMax: completar hasta el máximo (si no hay máximo, hasta el mínimo).
 * - toMin: completar sólo hasta el mínimo.
 * La cantidad se expresa en unidad de compra (redondeando hacia arriba si hay factor).
 */
export function suggestOrders(products: Product[], settings: Pick<Settings, 'suggestionMode'>): SuggestedGroup[] {
  const groups = new Map<string, SuggestedGroup>();
  for (const p of products) {
    if (!p.active || p.minStock <= 0 || p.stock > p.minStock) continue;
    const target = settings.suggestionMode === 'toMax' && p.maxStock > p.minStock ? p.maxStock : p.minStock;
    const needed = round3(target - Math.max(0, p.stock));
    if (needed <= 0) continue;
    const factor = p.purchaseFactor > 0 ? p.purchaseFactor : 1;
    const quantity = factor === 1 ? needed : Math.ceil(needed / factor);
    const key = p.supplierId ?? '';
    if (!groups.has(key)) groups.set(key, { supplierId: p.supplierId, lines: [] });
    groups.get(key)!.lines.push({ product: p, needed, quantity });
  }
  return [...groups.values()];
}

/** Crea un pedido en borrador por cada grupo de proveedor. */
export async function createSuggestedOrders(groups: SuggestedGroup[]): Promise<Order[]> {
  const created: Order[] = [];
  for (const g of groups) {
    if (!g.lines.length) continue;
    created.push(
      await saveOrder({
        supplierId: g.supplierId,
        status: 'borrador',
        date: nowIso(),
        notes: 'Pedido sugerido automáticamente',
        items: g.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, factor: l.product.purchaseFactor })),
      }),
    );
  }
  return created;
}

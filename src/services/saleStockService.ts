/**
 * Stock al vender (como un software gastronómico): cada plato de la carta puede tener receta.
 * Al cerrar un pedido se descuentan sus insumos con un movimiento "Venta" por producto.
 *
 * - Las cortesías también consumen mercadería (se descuentan igual).
 * - Es idempotente (clave venta:pedido:producto): reintentar no descuenta dos veces.
 * - Si el stock queda negativo no se frena la venta: queda a la vista para el próximo conteo.
 */
import { db } from '../database/db';
import type { MenuItem, Recipe, TableTicket } from '../models';
import { applyMovement } from './stockService';
import { getSettings } from './settingsService';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** ¿Está activado el descuento de stock al vender? (si no se tocó: sí). */
export const salonStockOn = (s: { salonStock?: boolean }) => s.salonStock !== false;

/** Cantidad de cada insumo por porción vendida. */
export function perPortion(recipe: Recipe | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!recipe?.items.length || !(recipe.yield > 0)) return out;
  for (const it of recipe.items) if (it.quantity > 0) out.set(it.productId, round3((out.get(it.productId) ?? 0) + it.quantity / recipe.yield));
  return out;
}

/** Lo que consume un pedido: producto → cantidad (en su unidad de stock). */
export function ticketConsumption(t: Pick<TableTicket, 'lines'>, items: Map<string, Pick<MenuItem, 'recipe'>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of t.lines) {
    if (!(l.qty > 0)) continue;
    for (const [pid, q] of perPortion(items.get(l.menuItemId)?.recipe)) out.set(pid, round3((out.get(pid) ?? 0) + q * l.qty));
  }
  return out;
}

/** Descuenta el stock de un pedido cerrado. Devuelve cuántos productos se descontaron. */
export async function consumeTicketStock(ticket: TableTicket, label: string): Promise<number> {
  if (!salonStockOn(await getSettings())) return 0;
  const items = new Map((await db.menuItems.toArray()).map((m) => [m.id, m]));
  const use = ticketConsumption(ticket, items);
  let n = 0;
  for (const [productId, qty] of use) {
    if (!(qty > 0) || !(await db.products.get(productId))) continue;
    const r = await applyMovement({
      productId, type: 'venta', delta: -qty, origin: 'salon', refId: ticket.id,
      reason: `Venta · ${label}`, idempotencyKey: `venta:${ticket.id}:${productId}`,
    });
    if (!r.duplicate) n++;
  }
  return n;
}

/**
 * Stock inteligente: cuánto se usa de verdad cada producto por día y para cuántos días alcanza.
 *
 * El consumo sale de los movimientos de los últimos N días: todo lo que salió del stock (ventas,
 * consumos de producción, salidas, mermas y lo que faltó en los conteos), restando lo que los
 * conteos encontraron de más. Los movimientos que se deshicieron no cuentan.
 */
import type { Product, StockMovement as Movement } from '../models';

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const DAY = 864e5;

export interface Usage {
  /** Lo que se usó en el período (en la unidad de stock). */
  used: number;
  perDay: number;
  /** Para cuántos días alcanza el stock actual (undefined si no se usa). */
  daysLeft?: number;
  /** Mermas (pérdidas: vencido, roto, mal estado) del período. */
  waste: number;
  /** Días que se tomaron para el promedio (menos si el producto es nuevo). */
  days: number;
}

const OUT = new Set(['venta', 'consumo', 'salida', 'perdida']);
const FIX = new Set(['conteo', 'ajuste']);

export function usageByProduct(products: Pick<Product, 'id' | 'stock' | 'createdAt' | 'active'>[], movements: Movement[], days = 30, now = Date.now()): Map<string, Usage> {
  const since = new Date(now - days * DAY).toISOString();
  const undone = new Set(movements.filter((m) => m.idempotencyKey?.startsWith('undo:')).map((m) => m.idempotencyKey!.slice(5)));
  const acc = new Map<string, { used: number; fix: number; waste: number }>();
  for (const m of movements) {
    if (m.createdAt < since || m.idempotencyKey?.startsWith('undo:') || undone.has(m.id)) continue;
    const a = acc.get(m.productId) ?? { used: 0, fix: 0, waste: 0 };
    if (OUT.has(m.type) && m.delta < 0) a.used += -m.delta;
    if (m.type === 'perdida' && m.delta < 0) a.waste += -m.delta;
    if (FIX.has(m.type)) a.fix += m.delta; // faltante (−) suma consumo; sobrante (+) lo descuenta
    acc.set(m.productId, a);
  }
  const out = new Map<string, Usage>();
  for (const p of products) {
    const a = acc.get(p.id);
    if (!a) continue;
    const used = round3(Math.max(0, a.used - a.fix));
    const age = p.createdAt ? Math.ceil((now - new Date(p.createdAt).getTime()) / DAY) : days;
    const d = Math.max(1, Math.min(days, age));
    const perDay = round3(used / d);
    out.set(p.id, { used, perDay, waste: round3(a.waste), days: d, daysLeft: perDay > 0 ? Math.floor((Math.max(0, p.stock) / perDay) * 10) / 10 : undefined });
  }
  return out;
}

/** "hoy", "1 día", "12 días", "+60 días". */
export function daysLabel(d?: number): string {
  if (d === undefined) return '';
  if (d < 1) return 'menos de 1 día';
  if (d > 60) return 'más de 60 días';
  const n = Math.floor(d);
  return `${n} ${n === 1 ? 'día' : 'días'}`;
}

/** Pedido según consumo: cuánto falta para cubrir `days` días de uso (sin bajar del mínimo). */
export function targetByUse(p: Pick<Product, 'minStock'>, u: Usage | undefined, days: number): number | undefined {
  if (!u || !(u.perDay > 0)) return undefined;
  return round3(Math.max(p.minStock, u.perDay * days));
}

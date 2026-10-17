/**
 * Precios de compra a partir de las facturas revisadas: cuánto costó cada producto en cada
 * factura (por unidad de stock) y qué aumentó respecto de la compra anterior.
 * No usa IA: sale de los renglones que ya quedaron vinculados a un producto.
 */
import type { Invoice, InvoiceItem } from '../models';
import { round3 } from '../utils/format';

export interface PricePoint {
  invoiceId: string;
  /** Fecha de la factura (AAAA-MM-DD). */
  date: string;
  supplierId?: string;
  number?: string;
  /** Precio del renglón tal como figura (por unidad de la factura: caja, bulto, kg…). */
  unitPrice: number;
  invoiceUnit?: string;
  /** Costo por unidad de stock del producto (precio del renglón ÷ unidades que sumó). */
  costPerUnit: number;
}

/** Costo por unidad de stock de un renglón (undefined si falta el precio o la cantidad). */
export function itemCost(item: InvoiceItem): number | undefined {
  if (item.status === 'ignored' || !item.productId) return undefined;
  const total = item.lineTotal != null && item.lineTotal > 0 ? item.lineTotal : item.unitPrice != null && item.quantity > 0 ? item.unitPrice * item.quantity : undefined;
  const qty = item.stockQty;
  if (total === undefined || !qty || qty <= 0) return undefined;
  return Math.round((total / qty) * 100) / 100;
}

/** Historial de precios de cada producto (más viejo primero). */
export function priceHistory(invoices: Invoice[]): Map<string, PricePoint[]> {
  const out = new Map<string, PricePoint[]>();
  for (const inv of invoices) {
    for (const item of inv.items ?? []) {
      const cost = itemCost(item);
      if (cost === undefined || !item.productId) continue;
      const list = out.get(item.productId) ?? [];
      list.push({ invoiceId: inv.id, date: inv.date, supplierId: inv.supplierId, number: inv.number, unitPrice: item.unitPrice ?? cost, invoiceUnit: item.unit, costPerUnit: cost });
      out.set(item.productId, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceId.localeCompare(b.invoiceId));
  return out;
}

export interface PriceChange {
  productId: string;
  previous: PricePoint;
  current: PricePoint;
  /** Variación en % (positivo = aumento). */
  pct: number;
}

/** Variación del último precio contra la compra anterior (de otra factura). */
export function lastChange(points: PricePoint[]): PriceChange | undefined {
  if (points.length < 2) return undefined;
  const current = points[points.length - 1];
  const previous = [...points].reverse().find((p) => p.invoiceId !== current.invoiceId);
  if (!previous || previous.costPerUnit <= 0) return undefined;
  return { productId: '', previous, current, pct: round3(((current.costPerUnit - previous.costPerUnit) / previous.costPerUnit) * 100) };
}

/**
 * Aumentos recientes: productos cuya última compra (desde `sinceYmd`) salió al menos `minPct` %
 * más cara que la anterior. Ordenados de mayor a menor aumento.
 */
export function priceIncreases(invoices: Invoice[], opts: { sinceYmd?: string; minPct?: number } = {}): PriceChange[] {
  const min = opts.minPct ?? 5;
  const out: PriceChange[] = [];
  for (const [productId, points] of priceHistory(invoices)) {
    const ch = lastChange(points);
    if (!ch || ch.pct < min) continue;
    if (opts.sinceYmd && ch.current.date < opts.sinceYmd) continue;
    out.push({ ...ch, productId });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/** Variación de un renglón de esta factura contra la compra anterior del mismo producto. */
export function changeForItem(invoice: Pick<Invoice, 'id' | 'date'>, item: InvoiceItem, history: Map<string, PricePoint[]>): number | undefined {
  const cost = itemCost(item);
  if (cost === undefined || !item.productId) return undefined;
  const prev = (history.get(item.productId) ?? [])
    .filter((p) => p.invoiceId !== invoice.id && (p.date < invoice.date || (p.date === invoice.date && p.invoiceId < invoice.id)))
    .pop();
  if (!prev || prev.costPerUnit <= 0) return undefined;
  return round3(((cost - prev.costPerUnit) / prev.costPerUnit) * 100);
}

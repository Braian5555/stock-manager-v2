/**
 * Reportes de ventas del salón: totales, por plato (con costo y margen), por día, por hora,
 * por medio de pago, por canal y por mozo. Cálculo puro (sin base de datos) para poder probarlo.
 *
 * Se cuentan los pedidos CERRADOS cuyo cierre cae en el período. Las ventas por plato son
 * antes del descuento general del pedido (el descuento se informa aparte).
 */
import type { FiscalSettings, MenuItem, Product, TableTicket, TicketChannel } from '../models';
import { PAYMENT_LABEL } from './fiscalService';
import type { ProductCost } from './costService';
import { dishCost } from './menuCostService';
import { CHANNEL_LABEL, channelOf, discountAmount } from './salonService';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Bucket { key: string; label: string; count: number; total: number }
export interface ItemRow {
  key: string; name: string; section: string; qty: number; comp: number; revenue: number;
  /** Costo de lo vendido (con receta y costos conocidos). */
  cost?: number; margin?: number; pct?: number;
}
export interface SalesReport {
  from: string; to: string;
  sold: number; orders: number; avg: number; guests: number;
  discounts: number; tips: number; compValue: number; cancelled: number;
  /** Costo de la mercadería vendida (sólo platos con receta) y su peso sobre lo vendido neto. */
  cost: number; costCoverage: number; foodCostPct?: number;
  byPayment: Bucket[]; byChannel: Bucket[]; byWaiter: Bucket[]; byHour: Bucket[]; byDay: Bucket[]; bySection: Bucket[];
  items: ItemRow[];
}

const PAY: Record<string, string> = PAYMENT_LABEL;

/** Día local (YYYY-MM-DD) y hora local de una fecha ISO. */
const ymd = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hour = (iso: string) => new Date(iso).getHours();

function add(m: Map<string, Bucket>, key: string, label: string, total: number, count = 1) {
  const b = m.get(key) ?? { key, label, count: 0, total: 0 };
  b.count += count;
  b.total = round2(b.total + total);
  m.set(key, b);
}
const sorted = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'es'));

export function salesReport(
  tickets: TableTicket[],
  range: { from: string; to: string },
  ctx: {
    menu: Map<string, Pick<MenuItem, 'name' | 'section' | 'price' | 'iva' | 'recipe'>>;
    costOf?: (id: string) => ProductCost | undefined;
    products?: Map<string, Pick<Product, 'name'>>;
    fiscal?: Pick<FiscalSettings, 'enabled' | 'condicionIva' | 'ivaDefault'>;
    payLabel?: Record<string, string>;
  },
): SalesReport {
  const inRange = (iso?: string) => !!iso && ymd(iso) >= range.from && ymd(iso) <= range.to;
  const closed = tickets.filter((t) => t.status === 'cerrada' && inRange(t.closedAt));
  const cancelled = tickets.filter((t) => t.status === 'anulada' && inRange(t.closedAt)).length;
  const pay = new Map<string, Bucket>(), chan = new Map<string, Bucket>(), waiter = new Map<string, Bucket>();
  const hours = new Map<string, Bucket>(), days = new Map<string, Bucket>(), sections = new Map<string, Bucket>();
  const items = new Map<string, ItemRow>();
  const unitCost = new Map<string, number | undefined>();
  const costPerPortion = (menuItemId: string): number | undefined => {
    if (unitCost.has(menuItemId)) return unitCost.get(menuItemId);
    const m = ctx.menu.get(menuItemId);
    const c = m && ctx.costOf ? dishCost(m, ctx.costOf, ctx.products ?? new Map(), ctx.fiscal) : undefined;
    const v = c && !c.missing.length ? c.cost : c && c.cost > 0 ? c.cost : undefined;
    unitCost.set(menuItemId, v);
    return v;
  };

  let sold = 0, guests = 0, discounts = 0, tips = 0, compValue = 0, cost = 0, coveredRevenue = 0;
  for (const t of closed) {
    sold += t.total;
    guests += t.guests ?? 0;
    discounts += discountAmount(t.subtotal ?? t.total, t.discount);
    tips += (t.charges ?? []).reduce((s, c) => s + (c.tip?.amount ?? 0), 0);
    const payments = t.charges?.length ? t.charges.flatMap((c) => c.payments) : t.payments ?? [];
    for (const p of payments) add(pay, p.method, (ctx.payLabel ?? PAY)[p.method] ?? p.method, p.amount);
    const ch: TicketChannel = channelOf(t);
    add(chan, ch, CHANNEL_LABEL[ch], t.total);
    add(waiter, t.openedBy?.id ?? '-', t.openedBy?.name ?? 'Sin dato', t.total);
    const h = hour(t.openedAt);
    add(hours, String(h).padStart(2, '0'), `${String(h).padStart(2, '0')} h`, t.total);
    const d = ymd(t.closedAt!);
    add(days, d, d, t.total);
    for (const l of t.lines) {
      if (!(l.qty > 0)) continue;
      const m = ctx.menu.get(l.menuItemId);
      const key = l.custom ? `custom:${l.name}` : l.menuItemId;
      const row = items.get(key) ?? { key, name: m?.name ?? l.name, section: l.custom ? 'Otros' : m?.section ?? 'Otros', qty: 0, comp: 0, revenue: 0 };
      const revenue = l.comp ? 0 : round2(l.qty * l.price);
      row.qty += l.qty;
      if (l.comp) { row.comp += l.qty; compValue += l.qty * l.price; }
      row.revenue = round2(row.revenue + revenue);
      const c = l.custom ? undefined : costPerPortion(l.menuItemId);
      if (c !== undefined) {
        row.cost = round2((row.cost ?? 0) + c * l.qty);
        cost += c * l.qty;
        coveredRevenue += revenue;
      }
      items.set(key, row);
      add(sections, row.section, row.section, revenue, l.qty);
    }
  }
  const net = (gross: number) => (ctx.fiscal?.enabled && ctx.fiscal.condicionIva === 'RI' ? gross / (1 + (ctx.fiscal.ivaDefault ?? 21) / 100) : gross);
  const rows = [...items.values()].map((r) => {
    if (r.cost === undefined) return r;
    const n = net(r.revenue);
    return { ...r, margin: round2(n - r.cost), pct: n > 0 ? Math.round((r.cost / n) * 1000) / 10 : undefined };
  }).sort((a, b) => b.revenue - a.revenue || b.qty - a.qty);

  const coveredNet = net(coveredRevenue);
  return {
    ...range,
    sold: round2(sold), orders: closed.length, avg: closed.length ? round2(sold / closed.length) : 0, guests,
    discounts: round2(discounts), tips: round2(tips), compValue: round2(compValue), cancelled,
    cost: round2(cost), costCoverage: sold > 0 ? Math.round((coveredRevenue / (sold + discounts)) * 100) : 0,
    foodCostPct: coveredNet > 0 ? Math.round((cost / coveredNet) * 1000) / 10 : undefined,
    byPayment: sorted(pay), byChannel: sorted(chan), byWaiter: sorted(waiter), bySection: sorted(sections),
    byHour: [...hours.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byDay: [...days.values()].sort((a, b) => a.key.localeCompare(b.key)),
    items: rows,
  };
}

/** Rango de fechas (YYYY-MM-DD, inclusive) de cada período rápido. */
export type QuickPeriod = 'hoy' | 'ayer' | '7d' | 'mes' | 'mesAnterior';
export function periodRange(p: QuickPeriod, today: Date = new Date()): { from: string; to: string } {
  const d = (x: Date) => ymd(x.toISOString());
  const day = (offset: number) => { const x = new Date(today); x.setDate(x.getDate() + offset); return x; };
  if (p === 'hoy') return { from: d(today), to: d(today) };
  if (p === 'ayer') return { from: d(day(-1)), to: d(day(-1)) };
  if (p === '7d') return { from: d(day(-6)), to: d(today) };
  if (p === 'mes') return { from: d(new Date(today.getFullYear(), today.getMonth(), 1)), to: d(today) };
  return { from: d(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: d(new Date(today.getFullYear(), today.getMonth(), 0)) };
}

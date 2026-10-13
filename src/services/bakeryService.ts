import { db } from '../database/db';
import type { Product, StockMovement } from '../models';
import { localYmd, round3 } from '../utils/format';
import { nowIso } from '../utils/id';
import { applyMovement } from './stockService';

/**
 * Panadería: plan del día, cierre (sobrantes y mermas) y resumen.
 * No usa tablas nuevas: el plan vive en cada producto (`productionPlan`, por fecha) y el
 * cierre se registra como movimientos de stock con claves determinísticas (no se duplica).
 */

export const MERMA_REASON = 'Merma panadería';
export const SOBRANTE_REASON = 'Cierre panadería: sobrante';
/** Días de plan que se conservan en cada producto (para el resumen "planificado vs producido"). */
const PLAN_DAYS_KEPT = 62;

export const ymdAdd = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return localYmd(new Date(y, m - 1, d + days));
};
export const planOf = (p: Pick<Product, 'productionPlan'>, date: string) => p.productionPlan?.[date] ?? 0;

/**
 * Clave del cierre: una por producto, día y tipo. Si ese cierre se deshizo (Movimientos →
 * revertir), se usa la siguiente (":2", ":3"…) para poder cargarlo de nuevo.
 */
async function closeKey(date: string, productId: string, kind: 'merma' | 'sobrante'): Promise<string> {
  const base = `cierre:${date}:${productId}:${kind}`;
  for (let n = 1; n < 50; n++) {
    const key = n === 1 ? base : `${base}:${n}`;
    const m = await db.movements.where('idempotencyKey').equals(key).first();
    if (!m) return key;
    const undone = await db.movements.where('idempotencyKey').equals(`undo:${m.id}`).first();
    if (!undone) return key; // vigente: applyMovement lo detecta como duplicado
  }
  return `${base}:${Date.now()}`;
}

/**
 * Guarda el plan de un día: cantidad por producto (0 o vacío lo saca del plan).
 * Sólo escribe los productos que cambian; de paso limpia planes de hace más de dos meses.
 */
export async function savePlan(date: string, quantities: Record<string, number | undefined>): Promise<number> {
  const oldest = ymdAdd(localYmd(), -PLAN_DAYS_KEPT);
  let changed = 0;
  await db.transaction('rw', db.products, async () => {
    const t = nowIso();
    const products = (await db.products.bulkGet(Object.keys(quantities))).filter((p): p is Product => !!p);
    const next: Product[] = [];
    for (const p of products) {
      const q = quantities[p.id];
      const value = q && q > 0 ? round3(q) : 0;
      if (planOf(p, date) === value) continue;
      const plan = Object.fromEntries(Object.entries(p.productionPlan ?? {}).filter(([d]) => d >= oldest && d !== date));
      if (value) plan[date] = value;
      next.push({ ...p, productionPlan: Object.keys(plan).length ? plan : undefined, updatedAt: t });
    }
    await db.products.bulkPut(next);
    changed = next.length;
  });
  return changed;
}

export interface CloseRow { productId: string; sobrante?: number; merma?: number }

/**
 * Cierre del día de un producto: la merma se descuenta ("Pérdida") y lo que sobró queda como
 * stock para el día siguiente (ajuste a esa cantidad). Cada cosa se registra una sola vez por día.
 */
export async function closeDay(date: string, rows: CloseRow[]): Promise<{ applied: number; duplicates: number }> {
  let applied = 0;
  let duplicates = 0;
  for (const r of rows) {
    if (r.merma !== undefined && r.merma > 0) {
      const { duplicate } = await applyMovement({ productId: r.productId, type: 'perdida', delta: -round3(r.merma), origin: 'manual', reason: MERMA_REASON, idempotencyKey: await closeKey(date, r.productId, 'merma') });
      if (duplicate) duplicates++;
      else applied++;
    }
    if (r.sobrante !== undefined && r.sobrante >= 0) {
      const { duplicate } = await applyMovement({ productId: r.productId, type: 'ajuste', newQuantity: round3(r.sobrante), origin: 'manual', reason: SOBRANTE_REASON, idempotencyKey: await closeKey(date, r.productId, 'sobrante') });
      if (duplicate) duplicates++;
      else applied++;
    }
  }
  return { applied, duplicates };
}

export interface BakeryRow {
  productId: string;
  name: string;
  planned: number;
  produced: number;
  merma: number;
  sobrante: number;
  /** Días del período con cierre cargado para este producto. */
  closedDays: number;
  /** Quiénes anotaron la producción. */
  people: string[];
}
export interface IngredientUse { productId: string; name: string; quantity: number }
export interface BakeryEntry { at: string; productId: string; name: string; quantity: number; by?: string }
export interface BakerySummary { rows: BakeryRow[]; ingredients: IngredientUse[]; productions: number; entries: BakeryEntry[] }

/**
 * Resumen de panadería entre dos fechas (inclusive, YYYY-MM-DD local): planificado, producido,
 * merma, sobrante y los insumos que se usaron. Lo deshecho no cuenta.
 */
export function bakerySummary(movements: StockMovement[], products: Product[], from: string, to: string): BakerySummary {
  const byId = new Map(products.map((p) => [p.id, p]));
  const undone = new Set(movements.filter((m) => m.idempotencyKey?.startsWith('undo:')).map((m) => m.idempotencyKey.slice(5)));
  const inRange = (m: StockMovement) => {
    const d = localYmd(m.createdAt);
    return d >= from && d <= to && !undone.has(m.id);
  };
  const rows = new Map<string, BakeryRow & { days: Set<string> }>();
  const entries: BakeryEntry[] = [];
  const row = (id: string, fallback?: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { productId: id, name: byId.get(id)?.name ?? fallback ?? '(producto eliminado)', planned: 0, produced: 0, merma: 0, sobrante: 0, closedDays: 0, people: [], days: new Set() };
      rows.set(id, r);
    }
    return r;
  };
  // Planificado: suma de los planes de cada día del período.
  for (const p of products) for (const [d, q] of Object.entries(p.productionPlan ?? {})) if (d >= from && d <= to && q > 0) row(p.id).planned += q;

  const productionIds = new Set<string>();
  const ingredients = new Map<string, IngredientUse>();
  let productions = 0;
  for (const m of movements) {
    if (!inRange(m)) continue;
    if (m.type === 'produccion') {
      const r = row(m.productId, m.productName);
      r.produced += m.delta;
      const who = m.performedBy?.name;
      if (who && !r.people.includes(who)) r.people.push(who);
      entries.push({ at: m.createdAt, productId: m.productId, name: r.name, quantity: m.delta, by: who });
      productionIds.add(m.id);
      productions++;
    } else if (m.type === 'perdida' && m.idempotencyKey?.startsWith('cierre:') && m.idempotencyKey.split(':')[3] === 'merma') {
      const r = row(m.productId, m.productName);
      r.merma += -m.delta;
      r.days.add(m.idempotencyKey.split(':')[1]);
    } else if (m.type === 'ajuste' && m.idempotencyKey?.startsWith('cierre:') && m.idempotencyKey.split(':')[3] === 'sobrante') {
      const r = row(m.productId, m.productName);
      r.sobrante += m.quantityAfter;
      r.days.add(m.idempotencyKey.split(':')[1]);
    }
  }
  for (const m of movements) {
    if (m.type !== 'consumo' || !m.refId || !productionIds.has(m.refId) || undone.has(m.id)) continue;
    const u = ingredients.get(m.productId) ?? { productId: m.productId, name: byId.get(m.productId)?.name ?? m.productName ?? '(producto eliminado)', quantity: 0 };
    u.quantity += -m.delta;
    ingredients.set(m.productId, u);
  }
  const clean = (n: number) => round3(n);
  return {
    productions,
    entries: entries.sort((a, b) => b.at.localeCompare(a.at)),
    rows: [...rows.values()]
      .map(({ days, ...r }) => ({ ...r, planned: clean(r.planned), produced: clean(r.produced), merma: clean(r.merma), sobrante: clean(r.sobrante), closedDays: days.size }))
      .sort((a, b) => b.produced - a.produced || a.name.localeCompare(b.name, 'es')),
    ingredients: [...ingredients.values()].map((u) => ({ ...u, quantity: clean(u.quantity) })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'es')),
  };
}

/** Productos con cierre ya cargado ese día (para no cargarlo dos veces). */
export function closedOn(movements: StockMovement[], date: string): Map<string, { merma?: number; sobrante?: number }> {
  const out = new Map<string, { merma?: number; sobrante?: number }>();
  const prefix = `cierre:${date}:`;
  const undone = new Set(movements.filter((m) => m.idempotencyKey?.startsWith('undo:')).map((m) => m.idempotencyKey.slice(5)));
  for (const m of movements) {
    if (!m.idempotencyKey?.startsWith(prefix) || undone.has(m.id)) continue;
    const [, , productId, kind] = m.idempotencyKey.split(':');
    const cur = out.get(productId) ?? {};
    if (kind === 'merma') cur.merma = -m.delta;
    if (kind === 'sobrante') cur.sobrante = m.quantityAfter;
    out.set(productId, cur);
  }
  return out;
}

/** Familias que se ven en Producción: las elegidas, o por defecto las de panadería/pastelería. */
export function productionFamilyIds(settings: { productionCategoryIds?: string[] }, categories: { id: string; name: string }[]): Set<string> {
  const chosen = settings.productionCategoryIds?.filter((id) => categories.some((c) => c.id === id));
  if (chosen && chosen.length) return new Set(chosen);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new Set(categories.filter((c) => /panad|pastel|reposter/.test(norm(c.name))).map((c) => c.id));
}

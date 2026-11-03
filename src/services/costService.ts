import type { Invoice, Product } from '../models';
import { priceHistory, type PricePoint } from './priceService';

/**
 * Costo de cada producto por unidad de stock:
 *  - insumos: el de la última factura revisada (o el costo cargado a mano en el producto);
 *  - elaborados: la suma de su receta (cantidad × costo de cada insumo) ÷ lo que rinde la tanda.
 *    Funciona con recetas dentro de recetas (masa de croissant → croissant).
 * También compara contra el costo con los precios de la compra anterior, para avisar qué receta se encareció.
 */

export type CostSource = 'factura' | 'manual' | 'receta';

export interface ProductCost {
  cost: number;
  source: CostSource;
  /** Fecha de la factura de donde sale (insumos). */
  date?: string;
  /** Insumos de la receta sin costo conocido (el costo de la receta queda incompleto). */
  missing: string[];
}

export interface RecipeLine { productId: string; name: string; quantity: number; unitCost?: number; total?: number }
export interface RecipeCost { productId: string; perUnit: number; perBatch: number; lines: RecipeLine[]; missing: string[]; previousPerUnit?: number; pct?: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildCosts(products: Product[], invoices: Invoice[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const history = priceHistory(invoices);
  const base = (p: Product, prev: boolean): { cost: number; source: CostSource; date?: string } | undefined => {
    const points: PricePoint[] = history.get(p.id) ?? [];
    const pick = prev ? points[points.length - 2] ?? points[points.length - 1] : points[points.length - 1];
    if (pick) return { cost: pick.costPerUnit, source: 'factura', date: pick.date };
    if (p.cost && p.cost > 0) return { cost: p.cost, source: 'manual' };
    return undefined;
  };
  const memo = new Map<string, ProductCost | undefined>();
  const memoPrev = new Map<string, number | undefined>();

  const costOf = (id: string, stack: Set<string> = new Set()): ProductCost | undefined => {
    if (memo.has(id)) return memo.get(id);
    const p = byId.get(id);
    if (!p) return undefined;
    let out: ProductCost | undefined;
    if (p.recipe?.items.length && p.recipe.yield > 0 && !stack.has(id)) {
      stack.add(id);
      let sum = 0;
      const missing: string[] = [];
      for (const it of p.recipe.items) {
        const c = costOf(it.productId, stack);
        if (!c) missing.push(byId.get(it.productId)?.name ?? '(insumo eliminado)');
        else { sum += c.cost * it.quantity; missing.push(...c.missing); }
      }
      stack.delete(id);
      out = { cost: round2(sum / p.recipe.yield), source: 'receta', missing: [...new Set(missing)] };
      // Un elaborado sin ningún insumo con costo no tiene costo útil.
      if (sum === 0 && missing.length) out = undefined;
    } else {
      const b = base(p, false);
      out = b && { ...b, missing: [] };
    }
    memo.set(id, out);
    return out;
  };

  /** Mismo cálculo con el precio de la compra ANTERIOR de cada insumo. */
  const prevCostOf = (id: string, stack: Set<string> = new Set()): number | undefined => {
    if (memoPrev.has(id)) return memoPrev.get(id);
    const p = byId.get(id);
    if (!p) return undefined;
    let out: number | undefined;
    if (p.recipe?.items.length && p.recipe.yield > 0 && !stack.has(id)) {
      stack.add(id);
      let sum = 0;
      let any = false;
      for (const it of p.recipe.items) {
        const c = prevCostOf(it.productId, stack);
        if (c !== undefined) { sum += c * it.quantity; any = true; }
      }
      stack.delete(id);
      out = any ? round2(sum / p.recipe.yield) : undefined;
    } else out = base(p, true)?.cost;
    memoPrev.set(id, out);
    return out;
  };

  const recipeCost = (id: string): RecipeCost | undefined => {
    const p = byId.get(id);
    if (!p?.recipe?.items.length || !(p.recipe.yield > 0)) return undefined;
    const lines: RecipeLine[] = p.recipe.items.map((it) => {
      const c = costOf(it.productId);
      return { productId: it.productId, name: byId.get(it.productId)?.name ?? '(insumo eliminado)', quantity: it.quantity, unitCost: c?.cost, total: c ? round2(c.cost * it.quantity) : undefined };
    });
    const perBatch = round2(lines.reduce((s, l) => s + (l.total ?? 0), 0));
    const total = costOf(id);
    const prev = prevCostOf(id);
    const perUnit = round2(perBatch / p.recipe.yield);
    const pct = prev && prev > 0 && perUnit > 0 ? Math.round(((perUnit - prev) / prev) * 1000) / 10 : undefined;
    return { productId: id, perUnit, perBatch, lines, missing: total?.missing ?? lines.filter((l) => l.unitCost === undefined).map((l) => l.name), previousPerUnit: prev, pct };
  };

  return { costOf, recipeCost };
}

/** Recetas que se encarecieron (≥ minPct %) por el último aumento de algún insumo, de mayor a menor. */
export function recipesGettingPricier(products: Product[], invoices: Invoice[], minPct = 5): (RecipeCost & { name: string })[] {
  const { recipeCost } = buildCosts(products, invoices);
  return products
    .filter((p) => p.active && p.recipe?.items.length)
    .map((p) => ({ ...recipeCost(p.id)!, name: p.name }))
    .filter((r) => r && r.pct !== undefined && r.pct >= minPct)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
}

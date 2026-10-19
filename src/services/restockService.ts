/**
 * Qué hay que reponer. Además de lo que está por debajo del mínimo, entra lo que está en 0 o en
 * negativo aunque no tenga mínimo cargado, siempre que se use (tuvo movimientos en las últimas
 * semanas o es insumo de una receta). Lo que está en 0 y no se mueve hace meses no se lista
 * (suelen ser productos que ya no se trabajan), para no tapar lo importante.
 */
import type { MovementType, Product, Settings, StockMovement } from '../models';
import { round3 } from '../utils/format';

export type RestockLevel = 'neg' | 'out' | 'crit' | 'low';
export const RESTOCK_LEVEL_LABEL: Record<RestockLevel, string> = { neg: 'Negativo', out: 'Sin stock', crit: 'Crítico', low: 'Bajo' };
const LEVEL_ORDER: Record<RestockLevel, number> = { neg: 0, out: 1, crit: 2, low: 3 };

/** Días de movimientos que se miran para saber si un producto "se usa" y cuánto se gasta. */
export const USAGE_DAYS = 28;
/** Lo que se sugiere pedir sin mínimo cargado: lo que se gasta en una semana. */
const COVER_DAYS = 7;
const OUTGOING: MovementType[] = ['salida', 'consumo', 'perdida'];

export interface Usage {
  /** Tuvo algún movimiento en el período. */
  moved: boolean;
  /** Salidas + consumos + pérdidas del período (positivo, unidad de stock). */
  out: number;
}

/** Uso de cada producto en los movimientos dados (se ignoran los deshechos). */
export function usageByProduct(movements: StockMovement[]): Map<string, Usage> {
  const undone = new Set(movements.filter((m) => m.idempotencyKey?.startsWith('undo:')).map((m) => m.idempotencyKey.slice(5)));
  const out = new Map<string, Usage>();
  for (const m of movements) {
    if (m.outletId || undone.has(m.id) || m.idempotencyKey?.startsWith('undo:')) continue;
    const u = out.get(m.productId) ?? { moved: false, out: 0 };
    u.moved = true;
    if (OUTGOING.includes(m.type) && m.delta < 0) u.out = round3(u.out - m.delta);
    out.set(m.productId, u);
  }
  return out;
}

export interface RestockLine {
  product: Product;
  level: RestockLevel;
  /** Es insumo de alguna receta. */
  inRecipe: boolean;
  /** Lo que se gasta por semana (según las últimas semanas), si hay datos. */
  weeklyUse?: number;
  /** Faltante sugerido en unidad de stock (sin dato si no hay mínimo ni consumo). */
  needed?: number;
  /** Cantidad sugerida en unidad de compra. */
  quantity?: number;
  /** De dónde sale la cantidad sugerida. */
  basis: 'maximo' | 'minimo' | 'consumo' | 'sin_dato';
}

export function restockList(products: Product[], movements: StockMovement[], settings: Pick<Settings, 'criticalRatio' | 'suggestionMode'>): { lines: RestockLine[]; idleAtZero: number } {
  const active = products.filter((p) => p.active);
  const usage = usageByProduct(movements);
  const inRecipes = new Set(active.flatMap((p) => p.recipe?.items.map((i) => i.productId) ?? []));
  const lines: RestockLine[] = [];
  let idleAtZero = 0;
  for (const p of active) {
    const u = usage.get(p.id);
    const inRecipe = inRecipes.has(p.id);
    const belowMin = p.minStock > 0 && p.stock <= p.minStock;
    const empty = p.stock <= 0;
    if (!belowMin && !empty) continue;
    // En 0 sin mínimo: sólo si se usa (si no, se cuenta aparte).
    if (!belowMin && p.stock === 0 && !u?.moved && !inRecipe) { idleAtZero++; continue; }
    const level: RestockLevel = p.stock < 0 ? 'neg' : p.stock <= 0 ? 'out' : p.stock <= p.minStock * settings.criticalRatio ? 'crit' : 'low';
    const weeklyUse = u && u.out > 0 ? round3((u.out / USAGE_DAYS) * COVER_DAYS) : undefined;
    let needed: number | undefined;
    let basis: RestockLine['basis'] = 'sin_dato';
    if (p.minStock > 0) {
      const toMax = settings.suggestionMode === 'toMax' && p.maxStock > p.minStock;
      needed = round3((toMax ? p.maxStock : p.minStock) - Math.max(0, p.stock));
      basis = toMax ? 'maximo' : 'minimo';
    } else if (weeklyUse) {
      needed = round3(weeklyUse - Math.max(0, p.stock));
      basis = 'consumo';
    }
    if (needed !== undefined && needed <= 0) { needed = undefined; basis = 'sin_dato'; }
    const factor = p.purchaseFactor > 1 ? p.purchaseFactor : 1;
    const quantity = needed === undefined ? undefined : factor === 1 ? Math.ceil(needed * 1000) / 1000 : Math.ceil(needed / factor);
    lines.push({ product: p, level, inRecipe, weeklyUse, needed, quantity, basis });
  }
  lines.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || Number(b.inRecipe) - Number(a.inRecipe) || a.product.name.localeCompare(b.product.name, 'es'));
  return { lines, idleAtZero };
}

/** ISO de hace USAGE_DAYS días (para pedir los movimientos a mirar). */
export const usageSinceIso = (now = Date.now()) => new Date(now - USAGE_DAYS * 86_400_000).toISOString();

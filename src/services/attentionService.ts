import type { Category, InventoryCount, Invoice, Product, StockMovement } from '../models';
import { localYmd, round3 } from '../utils/format';
import { ymdAdd } from './bakeryService';

/**
 * "Para resolver" del Inicio: lo que deja el stock desprolijo si nadie lo mira.
 *  - productos en negativo (y por qué quedaron así),
 *  - facturas que no se cargaron al stock,
 *  - conteos abiertos hace días,
 *  - familias que no se cuentan hace más de una semana (conteo semanal).
 */

export const STALE_COUNT_DAYS = 3;
export const WEEKLY_COUNT_DAYS = 7;

const undoneIds = (moves: StockMovement[]) => new Set(moves.filter((m) => m.idempotencyKey?.startsWith('undo:')).map((m) => m.idempotencyKey.slice(5)));

export const negativeProducts = (products: Product[]) => products.filter((p) => p.active && p.stock < -0.0005).sort((a, b) => a.stock - b.stock);

/** Facturas que no sumaron al stock (ni se marcaron como ya cargadas por otro lado). */
export const pendingInvoices = (invoices: Invoice[]) => invoices.filter((i) => !i.stockAppliedAt && !i.stockElsewhere).sort((a, b) => b.date.localeCompare(a.date));

/** Conteos abiertos hace más de N días (quedan colgados y confunden). */
export function staleCounts(counts: InventoryCount[], now = new Date(), days = STALE_COUNT_DAYS): InventoryCount[] {
  const limit = new Date(now.getTime() - days * 86_400_000).toISOString();
  return counts.filter((c) => c.status === 'abierto' && c.createdAt < limit).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface FamilyDue { category: Category; lastCounted?: string; products: Product[] }

/**
 * Conteo semanal: familias del Depósito Central (con productos) que no se contaron en los últimos 7 días.
 * "Contada" = algún producto de la familia tuvo un ajuste por conteo del Depósito Central.
 */
export function familiesDue(products: Product[], categories: Category[], moves: StockMovement[], today = localYmd(), days = WEEKLY_COUNT_DAYS): FamilyDue[] {
  const famOf = new Map(products.map((p) => [p.id, p.categoryId]));
  const last = new Map<string, string>();
  for (const m of moves) {
    if (m.origin !== 'conteo' || m.outletId) continue;
    const fam = famOf.get(m.productId);
    if (fam && (last.get(fam) ?? '') < m.createdAt) last.set(fam, m.createdAt);
  }
  const from = ymdAdd(today, -days);
  return categories
    .map((category) => ({ category, lastCounted: last.get(category.id), products: products.filter((p) => p.active && p.categoryId === category.id) }))
    .filter((f) => f.products.length && (!f.lastCounted || localYmd(f.lastCounted) < from))
    .sort((a, b) => (a.lastCounted ?? '').localeCompare(b.lastCounted ?? '') || a.category.name.localeCompare(b.category.name, 'es'));
}

export interface NegativeReason {
  /** Desde cuándo se mira: el último conteo/ajuste (o el principio). */
  since?: string;
  sinceLabel: string;
  base: number;
  ingresos: number;
  producido: number;
  recetas: number;
  salidas: number;
  remitos: number;
  otros: number;
  lastPurchase?: string;
  /** Explicación corta en castellano. */
  summary: string;
}

/**
 * Por qué un producto quedó en negativo: qué entró y qué salió desde el último conteo o ajuste.
 * Lo típico: las recetas descuentan insumos, pero la compra no se cargó (factura sin cargar al stock).
 */
export function explainNegative(product: Product, moves: StockMovement[]): NegativeReason {
  const undone = undoneIds(moves);
  const mine = moves
    .filter((m) => m.productId === product.id && !m.outletId && !undone.has(m.id) && !m.idempotencyKey?.startsWith('undo:'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastSet = [...mine].reverse().find((m) => m.type === 'ajuste' || m.origin === 'conteo');
  const after = lastSet ? mine.filter((m) => m.createdAt > lastSet.createdAt) : mine;
  const sum = (f: (m: StockMovement) => boolean) => round3(after.filter(f).reduce((s, m) => s + m.delta, 0));
  const ingresos = sum((m) => m.delta > 0 && (m.type === 'ingreso' || m.type === 'devolucion'));
  const producido = sum((m) => m.type === 'produccion');
  const recetas = -sum((m) => m.type === 'consumo' && !!m.refId);
  const remitos = -sum((m) => m.origin === 'remito');
  const salidas = -sum((m) => m.delta < 0 && !(m.type === 'consumo' && m.refId) && m.origin !== 'remito');
  const base = lastSet ? lastSet.quantityAfter : 0;
  const otros = round3(product.stock - base - ingresos - producido + recetas + remitos + salidas);
  const lastPurchase = [...mine].reverse().find((m) => m.type === 'ingreso' && m.delta > 0)?.createdAt;
  const sinceLabel = lastSet ? `desde el ${lastSet.origin === 'conteo' ? 'conteo' : 'ajuste'} del ${new Date(lastSet.createdAt).toLocaleDateString('es-AR')}` : 'desde que se cargó';
  const parts: string[] = [];
  if (recetas > 0) parts.push(`las recetas descontaron ${recetas}`);
  if (salidas > 0) parts.push(`salieron ${salidas}`);
  if (remitos > 0) parts.push(`se mandaron ${remitos} a los puntos`);
  const entered = ingresos + producido;
  const why = entered <= 0 ? 'y no entró nada' : `y sólo entraron ${round3(entered)}`;
  const hint = recetas > 0 && entered < recetas ? ' Seguramente falta cargar una factura de compra o contarlo.' : ' Contalo para dejarlo bien.';
  const summary = parts.length ? `${cap(sinceLabel)} ${parts.join(', ')} ${why}.${hint}` : `${cap(sinceLabel)} quedó en negativo.${hint}`;
  return { since: lastSet?.createdAt, sinceLabel, base, ingresos, producido, recetas, salidas, remitos, otros, lastPurchase, summary };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

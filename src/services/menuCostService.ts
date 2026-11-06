/**
 * Costo y margen de cada plato de la carta (food cost), a partir de su receta y del costo de
 * cada insumo (última factura, costo cargado a mano o receta del elaborado).
 *
 * El margen se calcula sobre el precio SIN IVA cuando se factura como Responsable Inscripto
 * (el IVA no es del negocio); si no, sobre el precio de carta.
 */
import type { FiscalSettings, MenuItem, Product } from '../models';
import type { ProductCost } from './costService';
import { perPortion } from './saleStockService';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DishLine { productId: string; name: string; qty: number; unitCost?: number; total?: number }
export interface DishCost {
  /** Costo de una porción (sólo con lo que tiene costo conocido). */
  cost: number;
  lines: DishLine[];
  /** Insumos sin costo conocido: el costo queda incompleto. */
  missing: string[];
  /** Precio que queda para el negocio (sin IVA si es RI). */
  net: number;
  margin: number;
  /** Costo / precio neto, en %. */
  pct?: number;
}

export function netPrice(item: Pick<MenuItem, 'price' | 'iva'>, fiscal?: Pick<FiscalSettings, 'enabled' | 'condicionIva' | 'ivaDefault'>): number {
  if (!fiscal?.enabled || fiscal.condicionIva !== 'RI') return item.price;
  const iva = item.iva ?? fiscal.ivaDefault ?? 21;
  return round2(item.price / (1 + iva / 100));
}

export function dishCost(
  item: Pick<MenuItem, 'price' | 'iva' | 'recipe'>,
  costOf: (id: string) => ProductCost | undefined,
  byId: Map<string, Pick<Product, 'name'>>,
  fiscal?: Pick<FiscalSettings, 'enabled' | 'condicionIva' | 'ivaDefault'>,
): DishCost | undefined {
  const use = perPortion(item.recipe);
  if (!use.size) return undefined;
  const lines: DishLine[] = [...use].map(([productId, qty]) => {
    const c = costOf(productId);
    return { productId, name: byId.get(productId)?.name ?? '(insumo eliminado)', qty, unitCost: c?.cost, total: c ? round2(c.cost * qty) : undefined };
  });
  const cost = round2(lines.reduce((s, l) => s + (l.total ?? 0), 0));
  const missing = [...new Set(lines.filter((l) => l.unitCost === undefined).map((l) => l.name))];
  const net = netPrice(item, fiscal);
  return { cost, lines, missing, net, margin: round2(net - cost), pct: net > 0 ? Math.round((cost / net) * 1000) / 10 : undefined };
}

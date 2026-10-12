import type { Category, Product, Supplier, Unit } from '../models';

export interface SheetRow {
  productId: string;
  name: string;
  /** Unidad en la que se pide (la de compra si tiene, si no la de stock), p. ej. "caja (12 kg)". */
  unit: string;
  min: number;
  stock: number;
  /** El proveedor es alternativo para este producto. */
  alternative: boolean;
}
export interface SheetGroup { family: string; rows: SheetRow[] }
export interface PurchaseSheet { supplier: Supplier; total: number; groups: SheetGroup[] }

export interface SheetOptions {
  /** Incluir productos donde el proveedor figura como alternativo. */
  alternatives: boolean;
}

/**
 * Planillas de compra: por cada proveedor, sus productos activos agrupados por familia
 * (orden alfabético, "Sin familia" al final), para imprimir y que la cocina marque qué pedir.
 */
export function buildPurchaseSheets(
  supplierIds: string[],
  data: { products: Product[]; suppliers: Supplier[]; categories: Category[]; units: Unit[] },
  opts: SheetOptions,
): PurchaseSheet[] {
  const cat = new Map(data.categories.map((c) => [c.id, c.name]));
  const unit = new Map(data.units.map((u) => [u.id, u.abbreviation || u.name]));
  const unitLabel = (p: Product) => {
    const stockU = (p.unitId && unit.get(p.unitId)) || 'u';
    if (!p.purchaseUnitId || p.purchaseUnitId === p.unitId) return stockU;
    const buyU = unit.get(p.purchaseUnitId) || 'u';
    return p.purchaseFactor > 0 && p.purchaseFactor !== 1 ? `${buyU} (${p.purchaseFactor} ${stockU})` : buyU;
  };
  const NONE = 'Sin familia';
  return supplierIds
    .map((id) => data.suppliers.find((s) => s.id === id))
    .filter((s): s is Supplier => !!s)
    .map((supplier) => {
      const mine = data.products.filter(
        (p) => p.active && (p.supplierId === supplier.id || (opts.alternatives && p.alternativeSupplierIds?.includes(supplier.id))),
      );
      const byFamily = new Map<string, SheetRow[]>();
      for (const p of mine) {
        const family = (p.categoryId && cat.get(p.categoryId)) || NONE;
        const list = byFamily.get(family) ?? [];
        list.push({ productId: p.id, name: p.name, unit: unitLabel(p), min: p.minStock, stock: p.stock, alternative: p.supplierId !== supplier.id });
        byFamily.set(family, list);
      }
      const groups = [...byFamily.entries()]
        .sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b, 'es')))
        .map(([family, rows]) => ({ family, rows: rows.sort((x, y) => x.name.localeCompare(y.name, 'es')) }));
      return { supplier, total: mine.length, groups };
    });
}

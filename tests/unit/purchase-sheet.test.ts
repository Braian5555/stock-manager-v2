import { describe, expect, it } from 'vitest';
import type { Category, Product, Supplier, Unit } from '../../src/models';
import { buildPurchaseSheets } from '../../src/services/purchaseSheet';

const t = '2026-01-01T00:00:00.000Z';
const base = { createdAt: t, updatedAt: t };
const sup = (id: string, name: string): Supplier => ({ ...base, id, name });
const prod = (p: Partial<Product> & { id: string; name: string }): Product => ({
  ...base, purchaseFactor: 1, alternativeSupplierIds: [], stock: 0, minStock: 0, maxStock: 0, active: true, ...p,
});
const categories: Category[] = [{ ...base, id: 'c1', name: 'Verduras' }, { ...base, id: 'c2', name: 'Almacén' }];
const units: Unit[] = [{ ...base, id: 'kg', name: 'Kilo', abbreviation: 'kg' }, { ...base, id: 'caj', name: 'Cajón', abbreviation: 'cajón' }];
const suppliers = [sup('s1', 'Lo de Camilo'), sup('s2', 'Fiordelmondo')];
const products = [
  prod({ id: 'p1', name: 'Tomate', supplierId: 's1', categoryId: 'c1', unitId: 'kg', purchaseUnitId: 'caj', purchaseFactor: 18, minStock: 10 }),
  prod({ id: 'p2', name: 'Cebolla', supplierId: 's1', categoryId: 'c1', unitId: 'kg' }),
  prod({ id: 'p3', name: 'Azúcar', supplierId: 's2', alternativeSupplierIds: ['s1'], categoryId: 'c2', unitId: 'kg' }),
  prod({ id: 'p4', name: 'Perejil', supplierId: 's1' }),
  prod({ id: 'p5', name: 'Viejo', supplierId: 's1', active: false }),
];

describe('planillas de compra', () => {
  it('agrupa por familia (Sin familia al final), ordena por nombre y usa la unidad de compra', () => {
    const [s] = buildPurchaseSheets(['s1'], { products, suppliers, categories, units }, { alternatives: false });
    expect(s.supplier.name).toBe('Lo de Camilo');
    expect(s.total).toBe(3); // el inactivo no va
    expect(s.groups.map((g) => g.family)).toEqual(['Verduras', 'Sin familia']);
    expect(s.groups[0].rows.map((r) => r.name)).toEqual(['Cebolla', 'Tomate']);
    expect(s.groups[0].rows[1]).toMatchObject({ unit: 'cajón (18 kg)', min: 10 });
    expect(s.groups[1].rows[0].unit).toBe('u');
  });

  it('opcionalmente suma los productos donde es proveedor alternativo, marcados', () => {
    const [s] = buildPurchaseSheets(['s1'], { products, suppliers, categories, units }, { alternatives: true });
    expect(s.total).toBe(4);
    const almacen = s.groups.find((g) => g.family === 'Almacén')!;
    expect(almacen.rows[0]).toMatchObject({ name: 'Azúcar', alternative: true });
  });

  it('una hoja por proveedor, en el orden pedido, ignorando ids que no existen', () => {
    const sheets = buildPurchaseSheets(['s2', 'nope', 's1'], { products, suppliers, categories, units }, { alternatives: false });
    expect(sheets.map((s) => s.supplier.name)).toEqual(['Fiordelmondo', 'Lo de Camilo']);
  });
});

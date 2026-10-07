import type { Table } from 'dexie';
import { db } from '../database/db';
import type { BaseEntity, Category, Location, Product, Supplier, Unit } from '../models';
import { nowIso, uuid } from '../utils/id';

export type Draft<T extends BaseEntity> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

/** Crea o actualiza una entidad completando id y fechas. */
export async function saveEntity<T extends BaseEntity>(table: Table<T, string>, draft: Draft<T>): Promise<T> {
  const t = nowIso();
  if (draft.id) {
    const prev = await table.get(draft.id);
    const record = { ...prev, ...draft, id: draft.id, createdAt: prev?.createdAt ?? t, updatedAt: t } as T;
    await table.put(record);
    return record;
  }
  const record = { ...draft, id: uuid(), createdAt: t, updatedAt: t } as T;
  await table.add(record);
  return record;
}

/** Instantánea para poder deshacer una eliminación. */
export interface UndoSnapshot {
  restore: () => Promise<void>;
}

type CatalogKind = 'category' | 'unit' | 'location' | 'supplier';

const PRODUCT_FIELDS: Record<CatalogKind, (keyof Product)[]> = {
  category: ['categoryId'],
  unit: ['unitId', 'purchaseUnitId'],
  location: ['locationId'],
  supplier: ['supplierId'],
};

function tableOf(kind: CatalogKind): Table<Category | Unit | Location | Supplier, string> {
  return { category: db.categories, unit: db.units, location: db.locations, supplier: db.suppliers }[kind] as Table<
    Category | Unit | Location | Supplier,
    string
  >;
}

export async function countProductsUsing(kind: CatalogKind, id: string): Promise<number> {
  const products = await db.products.toArray();
  return products.filter((p) =>
    PRODUCT_FIELDS[kind].some((f) => p[f] === id) || (kind === 'supplier' && p.alternativeSupplierIds.includes(id)),
  ).length;
}

/**
 * Elimina un elemento de catálogo. Los productos que lo usaban quedan sin ese dato
 * (no se borran). Devuelve una instantánea para deshacer.
 */
export async function deleteCatalogItem(kind: CatalogKind, id: string): Promise<UndoSnapshot> {
  const table = tableOf(kind);
  return db.transaction('rw', [table, db.products], async () => {
    const item = await table.get(id);
    if (!item) throw new Error('El elemento ya no existe.');
    const affected = (await db.products.toArray()).filter(
      (p) => PRODUCT_FIELDS[kind].some((f) => p[f] === id) || (kind === 'supplier' && p.alternativeSupplierIds.includes(id)),
    );
    for (const p of affected) {
      const patch: Partial<Product> = {};
      for (const f of PRODUCT_FIELDS[kind]) if (p[f] === id) (patch as Record<string, unknown>)[f] = undefined;
      if (kind === 'supplier') patch.alternativeSupplierIds = p.alternativeSupplierIds.filter((x) => x !== id);
      await db.products.update(p.id, patch);
    }
    await table.delete(id);
    return {
      restore: async () => {
        await db.transaction('rw', [table, db.products], async () => {
          await table.put(item);
          await db.products.bulkPut(affected);
        });
      },
    };
  });
}

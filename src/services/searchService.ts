import { db } from '../database/db';
import { matches } from '../utils/format';

export type SearchKind = 'product' | 'supplier' | 'category' | 'location' | 'unit';
export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle?: string;
  to: string;
}

/** Búsqueda global en productos (nombre/código), proveedores, familias, ubicaciones y unidades. */
export async function globalSearch(query: string, limit = 30): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const [products, suppliers, categories, locations, units] = await Promise.all([
    db.products.toArray(), db.suppliers.toArray(), db.categories.toArray(), db.locations.toArray(), db.units.toArray(),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const hits: SearchHit[] = [
    ...products
      .filter((p) => matches(query, p.name, p.sku, p.barcode, p.externalSystems?.maxirest?.code))
      .map((p) => ({ kind: 'product' as const, id: p.id, title: p.name, subtitle: [p.sku ?? p.barcode, p.categoryId && catName.get(p.categoryId)].filter(Boolean).join(' · '), to: `/productos?editar=${p.id}` })),
    ...suppliers
      .filter((s) => matches(query, s.name, s.contact, s.email, s.phone))
      .map((s) => ({ kind: 'supplier' as const, id: s.id, title: s.name, subtitle: s.contact, to: `/proveedores?editar=${s.id}` })),
    ...categories.filter((c) => matches(query, c.name)).map((c) => ({ kind: 'category' as const, id: c.id, title: c.name, to: `/stock?familia=${c.id}` })),
    ...locations.filter((l) => matches(query, l.name)).map((l) => ({ kind: 'location' as const, id: l.id, title: l.name, to: `/stock?ubicacion=${l.id}` })),
    ...units.filter((u) => matches(query, u.name, u.abbreviation)).map((u) => ({ kind: 'unit' as const, id: u.id, title: `${u.name} (${u.abbreviation})`, to: '/unidades' })),
  ];
  return hits.slice(0, limit);
}

import { db } from '../database/db';
import type { Product } from '../models';
import { normalize, parseNumber } from '../utils/format';
import { saveEntity } from '../services/entityService';
import { saveProduct, emptyProduct } from '../services/productService';
import type { Tabular } from './tabular';

const COLS = {
  name: ['nombre', 'producto', 'descripcion', 'articulo', 'insumo'],
  sku: ['codigo', 'sku', 'cod', 'codigo/sku'],
  category: ['familia', 'categoria', 'rubro'],
  unit: ['unidad', 'unidad de medida', 'medida'],
  location: ['ubicacion', 'deposito'],
  supplier: ['proveedor', 'proveedor principal'],
  min: ['minimo', 'stock minimo', 'min'],
  max: ['maximo', 'stock maximo', 'max'],
  stock: ['stock', 'stock inicial', 'cantidad', 'stock actual'],
  notes: ['observaciones', 'notas'],
} as const;
type Col = keyof typeof COLS;

export function detectProductColumns(headers: string[]): Partial<Record<Col, number>> {
  const n = headers.map(normalize);
  const out: Partial<Record<Col, number>> = {};
  for (const k of Object.keys(COLS) as Col[]) {
    const i = n.findIndex((h) => (COLS[k] as readonly string[]).includes(h));
    if (i >= 0) out[k] = i;
  }
  return out;
}

export interface ProductImportPlan {
  create: number;
  update: number;
  skipped: number;
  /** Productos nuevos que en el archivo traen stock negativo (p. ej. Maxirest con ventas sin stock cargado): se crean en 0. */
  negative: number;
  run: () => Promise<{ created: number; updated: number }>;
}

/**
 * Prepara la importación: productos existentes (mismo código o nombre) se actualizan
 * sin tocar su stock; los nuevos se crean con stock inicial. Familias, unidades,
 * ubicaciones y proveedores inexistentes se crean por nombre.
 */
export async function planProductImport(tab: Tabular): Promise<ProductImportPlan> {
  const cols = detectProductColumns(tab.headers);
  if (cols.name === undefined) throw new Error('No se encontró la columna "Nombre".');
  const existing = await db.products.toArray();
  const key = (p: { sku?: string; name: string }) => (p.sku ? `sku:${normalize(p.sku)}` : `name:${normalize(p.name)}`);
  const index = new Map<string, Product>();
  for (const p of existing) {
    index.set(`name:${normalize(p.name)}`, p);
    if (p.sku) index.set(`sku:${normalize(p.sku)}`, p);
  }
  const get = (r: (string | number | undefined)[], c: Col) => (cols[c] === undefined ? undefined : r[cols[c]!]);
  const str = (v: unknown) => (v === undefined ? undefined : String(v).trim() || undefined);
  const rows = tab.rows.map((r) => ({
    name: str(get(r, 'name')),
    sku: str(get(r, 'sku')),
    category: str(get(r, 'category')),
    unit: str(get(r, 'unit')),
    location: str(get(r, 'location')),
    supplier: str(get(r, 'supplier')),
    min: get(r, 'min'),
    max: get(r, 'max'),
    stock: get(r, 'stock'),
    notes: str(get(r, 'notes')),
  }));
  const valid = rows.filter((r): r is typeof r & { name: string } => !!r.name);
  const matchOf = (r: { sku?: string; name: string }) => index.get(key(r)) ?? index.get(`name:${normalize(r.name)}`);
  // Filas repetidas (mismo código o nombre) en el archivo: cuentan como un solo producto.
  const seen = new Set<string>();
  let create = 0;
  let update = 0;
  let negative = 0;
  for (const r of valid) {
    const k = matchOf(r) ? `id:${matchOf(r)!.id}` : key(r);
    const kn = `name:${normalize(r.name)}`;
    if (seen.has(k) || seen.has(kn)) { update++; continue; }
    seen.add(k);
    seen.add(kn);
    if (matchOf(r)) update++;
    else {
      create++;
      if (parseNumber(r.stock) < 0) negative++;
    }
  }

  return {
    create,
    update,
    skipped: rows.length - valid.length,
    negative,
    run: async () => {
      const cache = new Map<string, string>();
      const ensure = async (kind: 'categories' | 'units' | 'locations' | 'suppliers', name?: string) => {
        if (!name) return undefined;
        const k = `${kind}:${normalize(name)}`;
        if (cache.has(k)) return cache.get(k);
        const table = db[kind];
        const found = (await table.toArray()).find((x) => normalize(x.name) === normalize(name) || ('abbreviation' in x && normalize(x.abbreviation) === normalize(name)));
        const id = found?.id ?? (await saveEntity(table as never, (kind === 'units' ? { name, abbreviation: name } : { name }) as never) as { id: string }).id;
        cache.set(k, id);
        return id;
      };
      let created = 0;
      let updated = 0;
      for (const r of valid) {
        const prev = matchOf(r);
        const draft = {
          ...(prev ?? emptyProduct()),
          name: r.name,
          sku: r.sku ?? prev?.sku,
          categoryId: (await ensure('categories', r.category)) ?? prev?.categoryId,
          unitId: (await ensure('units', r.unit)) ?? prev?.unitId,
          locationId: (await ensure('locations', r.location)) ?? prev?.locationId,
          supplierId: (await ensure('suppliers', r.supplier)) ?? prev?.supplierId,
          minStock: r.min !== undefined ? parseNumber(r.min) : (prev?.minStock ?? 0),
          maxStock: r.max !== undefined ? parseNumber(r.max) : (prev?.maxStock ?? 0),
          notes: r.notes ?? prev?.notes,
        };
        // Stock negativo en el archivo (Maxirest descuenta ventas aunque no haya stock cargado):
        // no puede ser un stock inicial real, así que el producto se crea en 0.
        const initial = Math.max(0, parseNumber(r.stock));
        const saved = await saveProduct(draft, prev ? 0 : initial);
        // Así una fila repetida más abajo actualiza este producto en vez de crear otro.
        index.set(`name:${normalize(saved.name)}`, saved);
        if (saved.sku) index.set(`sku:${normalize(saved.sku)}`, saved);
        if (prev) updated++;
        else created++;
      }
      return { created, updated };
    },
  };
}

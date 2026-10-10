import { db } from '../database/db';
import type { Product } from '../models';
import { normalize, parseNumber } from '../utils/format';
import { saveEntity } from '../services/entityService';
import { saveProduct, emptyProduct } from '../services/productService';
import type { Tabular } from './tabular';
import { sameBarcode, validateBarcode } from '../utils/barcode';

const COLS = {
  name: ['nombre', 'producto', 'descripcion', 'articulo', 'insumo'],
  sku: ['codigo', 'sku', 'cod', 'codigo/sku'],
  barcode: ['codigo de barras', 'codigo barras', 'cod barras', 'barcode', 'ean', 'ean13'],
  category: ['familia', 'categoria', 'rubro'],
  unit: ['unidad', 'unidad de medida', 'medida'],
  location: ['ubicacion', 'deposito'],
  supplier: ['proveedor', 'proveedor principal'],
  altSuppliers: ['proveedores alternativos', 'proveedor alternativo', 'alternativos'],
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
  /** Códigos de barras que no se cargan porque ya los tiene otro producto o se repiten en el archivo. */
  barcodeConflicts: number;
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
    barcode: str(get(r, 'barcode')),
    category: str(get(r, 'category')),
    unit: str(get(r, 'unit')),
    location: str(get(r, 'location')),
    supplier: str(get(r, 'supplier')),
    altSuppliers: str(get(r, 'altSuppliers')),
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

  // Códigos de barras: se descartan los inválidos, los que ya tiene otro producto y los repetidos en el archivo.
  const barcodeFor = new Map<(typeof valid)[number], string | undefined>();
  const claimed: { code: string; owner: string }[] = existing.filter((p) => p.barcode).map((p) => ({ code: p.barcode!, owner: p.id }));
  let barcodeConflicts = 0;
  for (const r of valid) {
    if (!r.barcode) continue;
    const check = validateBarcode(r.barcode);
    const self = matchOf(r)?.id ?? `row:${normalize(r.sku ?? r.name)}`;
    const taken = check.ok && claimed.find((c) => c.owner !== self && sameBarcode(c.code, check.code));
    if (!check.ok || taken) { barcodeConflicts++; continue; }
    claimed.push({ code: check.code, owner: self });
    barcodeFor.set(r, check.code);
  }

  return {
    create,
    update,
    barcodeConflicts,
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
          barcode: barcodeFor.get(r) ?? prev?.barcode,
          categoryId: (await ensure('categories', r.category)) ?? prev?.categoryId,
          unitId: (await ensure('units', r.unit)) ?? prev?.unitId,
          locationId: (await ensure('locations', r.location)) ?? prev?.locationId,
          supplierId: (await ensure('suppliers', r.supplier)) ?? prev?.supplierId,
          // "Proveedores alternativos": nombres separados por coma o punto y coma.
          alternativeSupplierIds: r.altSuppliers
            ? (await Promise.all(r.altSuppliers.split(/[,;]/).map((n) => ensure('suppliers', n.trim() || undefined)))).filter((x): x is string => !!x)
            : (prev?.alternativeSupplierIds ?? []),
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

/**
 * MAXIREST EXCEL BRIDGE
 *
 * Maxirest permite, desde Stock → Inventarios, exportar un inventario a Excel e
 * "importar inventarios hechos con anterioridad". La documentación oficial NO publica
 * una plantilla ni nombres de columnas, por eso:
 *  - Al importar se detectan columnas por nombre y el usuario confirma/corrige el mapeo.
 *  - Al exportar se genera un Excel legible para carga MANUAL en Maxirest
 *    (columna "Conteo"), no un archivo garantizado para importación automática.
 */
import { db } from '../../database/db';
import type { Product } from '../../models';
import { normalize, parseNumber } from '../../utils/format';
import type { Cell, Tabular } from '../../importers/tabular';
import { upsertReferences } from '../core/linking';

export const BRIDGE_FIELDS = ['code', 'name', 'unit', 'stock', 'counted', 'location', 'category'] as const;
export type BridgeField = (typeof BRIDGE_FIELDS)[number];
export type BridgeMapping = Partial<Record<BridgeField, number>>;

export const BRIDGE_FIELD_LABEL: Record<BridgeField, string> = {
  code: 'Código de insumo',
  name: 'Nombre / descripción',
  unit: 'Unidad de medida',
  stock: 'Stock actual (Maxirest)',
  counted: 'Conteo',
  location: 'Depósito',
  category: 'Rubro',
};

const ALIASES: Record<BridgeField, string[]> = {
  code: ['codigo', 'cod', 'cod.', 'codigo insumo', 'cod insumo', 'id', 'sku'],
  name: ['nombre', 'insumo', 'descripcion', 'articulo', 'producto', 'detalle'],
  unit: ['unidad', 'unidad de medida', 'medida', 'um', 'u.m.'],
  stock: ['stock', 'stock actual', 'existencia', 'saldo', 'stock sistema', 'cantidad sistema', 'stock maxirest'],
  counted: ['conteo', 'contado', 'cantidad contada', 'fisico', 'stock fisico', 'recuento'],
  location: ['deposito'],
  category: ['rubro', 'familia', 'categoria'],
};

export function detectMapping(headers: string[]): BridgeMapping {
  const norm = headers.map((h) => normalize(h));
  const mapping: BridgeMapping = {};
  const taken = new Set<number>();
  for (const field of BRIDGE_FIELDS) {
    // 1) coincidencia exacta, 2) el encabezado empieza con el alias
    let idx = norm.findIndex((h, i) => !taken.has(i) && ALIASES[field].includes(h));
    if (idx < 0) idx = norm.findIndex((h, i) => !taken.has(i) && ALIASES[field].some((a) => a.length > 3 && h.startsWith(a)));
    if (idx >= 0) {
      mapping[field] = idx;
      taken.add(idx);
    }
  }
  return mapping;
}

export interface BridgeRow {
  externalId: string;
  code?: string;
  name: string;
  unitName?: string;
  stock?: number;
  counted?: number;
  locationName?: string;
  categoryName?: string;
}

const text = (c: Cell) => (c === undefined ? undefined : String(c).trim() || undefined);

export function toBridgeRows(tab: Tabular, mapping: BridgeMapping): { rows: BridgeRow[]; skipped: number } {
  if (mapping.name === undefined && mapping.code === undefined) throw new Error('Indicá al menos la columna de código o de nombre.');
  const rows: BridgeRow[] = [];
  let skipped = 0;
  const get = (r: Cell[], f: BridgeField) => (mapping[f] === undefined ? undefined : r[mapping[f]!]);
  for (const r of tab.rows) {
    const code = text(get(r, 'code'));
    const name = text(get(r, 'name')) ?? code;
    if (!name) {
      skipped++;
      continue;
    }
    const stockRaw = get(r, 'stock');
    const countedRaw = get(r, 'counted');
    rows.push({
      // Sin API no hay ID interno de Maxirest: el código de insumo actúa como identificador.
      externalId: code ?? `nombre:${normalize(name)}`,
      code,
      name,
      unitName: text(get(r, 'unit')),
      stock: stockRaw === undefined || String(stockRaw).trim() === '' ? undefined : parseNumber(stockRaw),
      counted: countedRaw === undefined || String(countedRaw).trim() === '' ? undefined : parseNumber(countedRaw),
      locationName: text(get(r, 'location')),
      categoryName: text(get(r, 'category')),
    });
  }
  return { rows, skipped };
}

/** Guarda el inventario de Maxirest como copia externa (para conciliación y conteos). */
export async function importBridgeRows(rows: BridgeRow[]): Promise<number> {
  return upsertReferences(
    'maxirest',
    'product',
    rows.map((r) => ({ externalId: r.externalId, code: r.code, name: r.name, stock: r.stock, unitName: r.unitName, categoryName: r.categoryName, locationName: r.locationName, source: 'excel' as const })),
  );
}

export interface BridgeExportLine {
  code: string;
  name: string;
  unit: string;
  maxirestStock?: number;
  counted?: number;
}

/** Arma las líneas para cargar en Maxirest a partir de un conteo (o del stock actual). */
export async function buildExportLines(countId?: string): Promise<BridgeExportLine[]> {
  const [products, units, refs] = await Promise.all([
    db.products.toArray(), db.units.toArray(), db.externalReferences.where({ system: 'maxirest', entityType: 'product' }).toArray(),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.abbreviation]));
  const refStock = new Map(refs.map((r) => [r.externalId, r.stock]));
  const counted = new Map<string, number | undefined>();
  if (countId) for (const i of await db.countItems.where('countId').equals(countId).toArray()) counted.set(i.productId, i.counted);
  const codeOf = (p: Product) => p.externalSystems?.maxirest?.code ?? p.externalSystems?.maxirest?.id ?? p.sku ?? '';
  return products
    .filter((p) => p.active && (!countId || counted.has(p.id)))
    .map((p) => ({
      code: codeOf(p),
      name: p.name,
      unit: (p.unitId && unitName.get(p.unitId)) || '',
      maxirestStock: p.externalSystems?.maxirest ? refStock.get(p.externalSystems.maxirest.id) : undefined,
      counted: countId ? counted.get(p.id) : p.stock,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
}

export const BRIDGE_INSTRUCTIONS = [
  'Archivo generado por Stock Manager para cargar un conteo en Maxirest.',
  'Proceso MANUAL (requiere intervención del usuario):',
  '1. En Maxirest: Menú → Stock → Inventarios → Nuevo. Elegir fecha, turno y depósito.',
  '2. Presionar "Preparar inventario" (opcional: filtrar por rubro).',
  '3. Copiar la columna "Conteo" de este archivo en la columna "conteo" de Maxirest, buscando cada insumo por su código.',
  '4. Revisar las diferencias en Maxirest. Si corresponde, tildar "Ajuste automático de stock" y elegir el concepto.',
  '5. Guardar el inventario en Maxirest.',
  'Nota: Maxirest no documenta una plantilla de importación de Excel. Si tu versión permite importar',
  'este archivo directamente, verificalo primero con un inventario de prueba.',
];

import { CURRENT_DB_VERSION, DATA_TABLES, db, type DataTableName } from '../database/db';
import type { Integration } from '../models';
import { nowIso } from '../utils/id';
import { normalizeSettings } from './settingsService';

export const BACKUP_FORMAT = 'stock-manager-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  dbVersion: number;
  exportedAt: string;
  app: { name: string; version: string };
  tables: Partial<Record<DataTableName, Record<string, unknown>[]>>;
}

/** Claves que JAMÁS deben salir en un backup, aunque alguna versión futura las guarde. */
const SECRET_KEY = /(secret|token|password|passwd|pwd|api[-_]?key|apikey|authorization|credential|bearer|private[-_]?key)/i;

export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSecrets) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEY.test(k)) out[k] = stripSecrets(v);
    return out as T;
  }
  return value;
}

export async function createBackup(): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {};
  for (const name of DATA_TABLES) tables[name] = stripSecrets(await db.table(name).toArray());
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    dbVersion: CURRENT_DB_VERSION,
    exportedAt: nowIso(),
    app: { name: 'Stock Manager', version: __APP_VERSION__ },
    tables,
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  counts: Partial<Record<DataTableName, number>>;
}

const REQUIRED_FIELDS: Partial<Record<DataTableName, string[]>> = {
  products: ['id', 'name'],
  suppliers: ['id', 'name'],
  categories: ['id', 'name'],
  units: ['id', 'name'],
  locations: ['id', 'name'],
  orders: ['id', 'number', 'status'],
  orderItems: ['id', 'orderId', 'productId'],
  movements: ['id', 'productId', 'idempotencyKey'],
  counts: ['id', 'status'],
  countItems: ['id', 'countId', 'productId'],
};

/** Valida la estructura antes de tocar la base local. */
export function validateBackup(data: unknown): ValidationResult {
  const errors: string[] = [];
  const counts: ValidationResult['counts'] = {};
  if (!data || typeof data !== 'object') return { ok: false, errors: ['El archivo no contiene un JSON válido.'], counts };
  const b = data as Partial<BackupFile>;
  if (b.format !== BACKUP_FORMAT) errors.push('El archivo no es una copia de seguridad de Stock Manager.');
  if (typeof b.dbVersion === 'number' && b.dbVersion > CURRENT_DB_VERSION)
    errors.push('La copia fue creada con una versión más nueva de la app. Actualizá la app antes de restaurarla.');
  if (!b.tables || typeof b.tables !== 'object') errors.push('Falta la sección de datos.');
  else {
    for (const name of DATA_TABLES) {
      const rows = (b.tables as Record<string, unknown>)[name];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) {
        errors.push(`"${name}" no es una lista.`);
        continue;
      }
      const required = REQUIRED_FIELDS[name] ?? ['id'];
      const bad = rows.findIndex((r) => !r || typeof r !== 'object' || required.some((f) => (r as Record<string, unknown>)[f] === undefined));
      if (bad >= 0) errors.push(`"${name}": el registro ${bad + 1} está incompleto.`);
      counts[name] = rows.length;
    }
    if (!Array.isArray((b.tables as Record<string, unknown>).products)) errors.push('La copia no contiene productos.');
  }
  return { ok: errors.length === 0, errors, counts };
}

/**
 * Reemplaza TODOS los datos locales por los del backup (en una sola transacción:
 * si algo falla, no se pierde nada). Las integraciones quedan "desconectadas"
 * porque un backup nunca incluye credenciales.
 */
export async function restoreBackup(data: BackupFile): Promise<void> {
  const check = validateBackup(data);
  if (!check.ok) throw new Error(check.errors.join(' '));
  const tables = DATA_TABLES.map((n) => db.table(n));
  await db.transaction('rw', tables, async () => {
    for (const name of DATA_TABLES) {
      await db.table(name).clear();
      let rows = stripSecrets((data.tables[name] ?? []) as Record<string, unknown>[]);
      if (name === 'settings') rows = rows.map((s) => normalizeSettings(s) as unknown as Record<string, unknown>);
      if (name === 'integrations')
        rows = rows.map((i) => {
          const it = i as unknown as Integration;
          return { ...it, status: it.mode === 'disabled' ? 'no_configurado' : 'desconectado' } as unknown as Record<string, unknown>;
        });
      if (name === 'products')
        rows = rows.map((p) => ({ purchaseFactor: 1, alternativeSupplierIds: [], active: true, stock: 0, minStock: 0, maxStock: 0, ...p }));
      if (rows.length) await db.table(name).bulkPut(rows);
    }
  });
}

import Dexie, { type Table } from 'dexie';
import type {
  Business, Category, ExternalReference, InventoryCount, InventoryCountItem, Integration, Location, Order,
  OrderItem, Product, Settings, StockMovement, Supplier, SyncJob, Unit,
} from '../models';

export const DB_NAME = 'stock-manager';

/**
 * Historial de esquemas. NUNCA editar una versión publicada: agregar una nueva
 * con su función upgrade(). Dexie aplica las migraciones en orden y conserva los datos.
 */
export const SCHEMA_V1 = {
  businesses: 'id',
  settings: 'id',
  products: 'id, name, sku, categoryId, locationId, supplierId, active, updatedAt',
  categories: 'id, name',
  units: 'id, name',
  locations: 'id, name',
  suppliers: 'id, name',
  orders: 'id, &number, status, supplierId, date',
  orderItems: 'id, orderId, productId',
  movements: 'id, &idempotencyKey, productId, type, createdAt, refId',
  counts: 'id, status, createdAt',
  countItems: 'id, countId, productId, [countId+productId]',
};

export const SCHEMA_V2 = {
  ...SCHEMA_V1,
  integrations: 'id, system',
  syncJobs: 'id, &idempotencyKey, system, status, createdAt',
  externalReferences: 'id, [system+entityType+externalId], [system+entityType], code',
};

/**
 * v3: sincronización en la nube.
 *  - orders.number deja de ser único (dos dispositivos pueden numerar a la vez).
 *  - meta: estado local del dispositivo (vínculo con la nube, etc.). Nunca se sincroniza.
 */
export const SCHEMA_V3 = {
  ...SCHEMA_V2,
  orders: 'id, number, status, supplierId, date',
  meta: 'key',
};

export const CURRENT_DB_VERSION = 3;

/** Tablas de negocio que se sincronizan con la nube. */
export const SYNC_TABLES = [
  'settings', 'categories', 'units', 'locations', 'suppliers', 'products', 'orders', 'orderItems', 'movements', 'counts', 'countItems',
] as const;
export type SyncTableName = (typeof SYNC_TABLES)[number];
const SYNC_SET = new Set<string>(SYNC_TABLES);

export interface MetaRecord {
  key: string;
  value: unknown;
}

/**
 * Escucha de cambios para la sincronización. Se invoca por cada escritura en una tabla
 * sincronizada con los ids afectados y la transacción nativa de IndexedDB (para enviar
 * los cambios sólo cuando la transacción se confirma).
 */
type MutationListener = (table: SyncTableName, ids: string[], trans: IDBTransaction) => void;
let mutationListener: MutationListener | null = null;
export function setMutationListener(fn: MutationListener | null) {
  mutationListener = fn;
}

export class StockDatabase extends Dexie {
  businesses!: Table<Business, string>;
  settings!: Table<Settings, string>;
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  units!: Table<Unit, string>;
  locations!: Table<Location, string>;
  suppliers!: Table<Supplier, string>;
  orders!: Table<Order, string>;
  orderItems!: Table<OrderItem, string>;
  movements!: Table<StockMovement, string>;
  counts!: Table<InventoryCount, string>;
  countItems!: Table<InventoryCountItem, string>;
  integrations!: Table<Integration, string>;
  syncJobs!: Table<SyncJob, string>;
  externalReferences!: Table<ExternalReference, string>;
  meta!: Table<MetaRecord, string>;

  constructor(name = DB_NAME) {
    super(name);
    // v1: núcleo de inventario.
    this.version(1).stores(SCHEMA_V1);
    // v2: integraciones + unidades de compra y proveedores alternativos en productos.
    this.version(2)
      .stores(SCHEMA_V2)
      .upgrade(async (tx) => {
        await tx.table('products').toCollection().modify((p: Partial<Product>) => {
          if (typeof p.purchaseFactor !== 'number' || p.purchaseFactor <= 0) p.purchaseFactor = 1;
          if (!Array.isArray(p.alternativeSupplierIds)) p.alternativeSupplierIds = [];
          if (typeof p.active !== 'boolean') p.active = true;
        });
      });
    // v3: sincronización en la nube (sin cambios de datos: sólo índices y tabla meta).
    this.version(3).stores(SCHEMA_V3);

    // Middleware: informa qué registros cambiaron en las tablas sincronizadas.
    this.use({
      stack: 'dbcore',
      name: 'cloud-sync-tracker',
      create(down) {
        return {
          ...down,
          table(name) {
            const table = down.table(name);
            if (!SYNC_SET.has(name)) return table;
            return {
              ...table,
              mutate(req) {
                if (mutationListener) {
                  let ids: string[] = [];
                  if (req.type === 'add' || req.type === 'put') ids = req.values.map((v) => String((v as { id: string }).id));
                  else if (req.type === 'delete') ids = req.keys.map(String);
                  if (ids.length) mutationListener(name as SyncTableName, ids, req.trans as unknown as IDBTransaction);
                }
                return table.mutate(req);
              },
            };
          },
        };
      },
    });
  }
}

export const db = new StockDatabase();

/** Tablas incluidas en backups y exportaciones completas. */
export const DATA_TABLES = [
  'businesses', 'settings', 'categories', 'units', 'locations', 'suppliers', 'products', 'orders', 'orderItems',
  'movements', 'counts', 'countItems', 'integrations', 'syncJobs', 'externalReferences',
] as const;
export type DataTableName = (typeof DATA_TABLES)[number];

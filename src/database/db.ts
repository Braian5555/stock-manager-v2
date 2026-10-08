import Dexie, { type Table } from 'dexie';
import type {
  Business, Category, ExternalReference, InventoryCount, InventoryCountItem, Integration, Location, Order,
  OrderItem, Product, Settings, StockMovement, Supplier, SyncJob, Unit, AppUser, Invoice, InvoiceImage, Outlet, Transfer,
} from '../models';

export const DB_NAME = 'stock-manager';
/** Clave en `meta` del vínculo de este dispositivo con un espacio en la nube. */
export const CLOUD_LINK_KEY = 'cloud.link';

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

/** v4: usuarios internos de la app (nombre + PIN). Se sincronizan con la nube. */
export const SCHEMA_V4 = {
  ...SCHEMA_V3,
  users: 'id, name',
};

/**
 * v5: facturas de proveedores. Las fotos (invoiceImages) NO van por la sincronización
 * general: se suben y bajan bajo demanda para no descargar todas en cada dispositivo.
 */
export const SCHEMA_V5 = {
  ...SCHEMA_V4,
  invoices: 'id, date, supplierId, orderId, updatedAt',
  invoiceImages: 'id, invoiceId, uploaded',
};

/** v6: puntos gastronómicos y remitos internos (Depósito Central → punto). */
export const SCHEMA_V6 = {
  ...SCHEMA_V5,
  outlets: 'id, name',
  transfers: 'id, number, date, outletId, status, maxirest, updatedAt',
};

/**
 * v7: lápidas locales de lo que se eliminó en tablas sincronizadas. Sirven para que la
 * eliminación llegue a la nube aunque se haya hecho sin conexión o con la nube apagada,
 * y para que un dispositivo desactualizado no "reviva" lo borrado. Nunca se sincroniza.
 */
export const SCHEMA_V7 = {
  ...SCHEMA_V6,
  tombstones: 'key, pushed',
};

export const CURRENT_DB_VERSION = 7;

/** Tablas de negocio que se sincronizan con la nube. */
export const SYNC_TABLES = [
  'settings', 'categories', 'units', 'locations', 'suppliers', 'products', 'orders', 'orderItems', 'movements', 'counts', 'countItems', 'users', 'invoices', 'outlets', 'transfers',
] as const;
export type SyncTableName = (typeof SYNC_TABLES)[number];
const SYNC_SET = new Set<string>(SYNC_TABLES);

export interface Tombstone {
  /** `${tabla}:${id}` */
  key: string;
  table: SyncTableName;
  id: string;
  updatedAt: string;
  /** 1 = la nube ya la tiene. */
  pushed: 0 | 1;
}

/** Transacciones abiertas al aplicar datos de la nube: no se vuelven a subir ni generan lápidas. */
export const remoteTransactions = new WeakSet<IDBTransaction>();

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
  users!: Table<AppUser, string>;
  invoices!: Table<Invoice, string>;
  invoiceImages!: Table<InvoiceImage, string>;
  outlets!: Table<Outlet, string>;
  transfers!: Table<Transfer, string>;
  tombstones!: Table<Tombstone, string>;

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
    // v4: usuarios con PIN.
    this.version(4).stores(SCHEMA_V4);
    // v5: facturas con fotos.
    this.version(5).stores(SCHEMA_V5);
    // v6: remitos internos a los puntos.
    this.version(6).stores(SCHEMA_V6);
    // v7: lápidas locales para la sincronización.
    this.version(7).stores(SCHEMA_V7);

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
                const trans = req.trans as unknown as IDBTransaction;
                let ids: string[] = [];
                if (req.type === 'add' || req.type === 'put') ids = req.values.map((v) => String((v as { id: string }).id));
                else if (req.type === 'delete') ids = req.keys.map(String);
                if (ids.length && mutationListener) mutationListener(name as SyncTableName, ids, trans);
                // Eliminación local: se guarda una lápida cuando la transacción se confirma.
                if (req.type === 'delete' && ids.length && !remoteTransactions.has(trans)) {
                  const at = new Date().toISOString();
                  trans.addEventListener('complete', () => {
                    void db.tombstones
                      .bulkPut(ids.map((id) => ({ key: `${name}:${id}`, table: name as SyncTableName, id, updatedAt: at, pushed: 0 as const })))
                      .catch(() => undefined);
                  });
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
  'movements', 'counts', 'countItems', 'integrations', 'syncJobs', 'externalReferences', 'users', 'invoices', 'outlets', 'transfers',
] as const;
export type DataTableName = (typeof DATA_TABLES)[number];

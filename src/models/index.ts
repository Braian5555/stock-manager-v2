/**
 * Modelo de datos de Stock Manager.
 * Todas las entidades persistidas tienen id (UUID), createdAt y updatedAt (ISO 8601).
 */

export type ID = string;
export type ISODate = string;

export interface BaseEntity {
  id: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Vínculo de una entidad local con un registro de un sistema externo (p. ej. Maxirest). */
export interface ExternalLink {
  id: string;
  code?: string;
  lastSyncedAt?: ISODate;
}
export type ExternalSystems = Partial<Record<ExternalSystemId, ExternalLink>>;
export type ExternalSystemId = 'maxirest';

export interface Business extends BaseEntity {
  name: string;
  subtitle?: string;
}

export interface Category extends BaseEntity {
  name: string;
  color?: string;
  externalSystems?: ExternalSystems;
}

export interface Unit extends BaseEntity {
  name: string;
  abbreviation: string;
  /** Unidades de sistema (kg, unidad...) se pueden renombrar pero se crean al inicio. */
  externalSystems?: ExternalSystems;
}

export interface Location extends BaseEntity {
  name: string;
  description?: string;
  externalSystems?: ExternalSystems;
}

export interface Supplier extends BaseEntity {
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface Product extends BaseEntity {
  name: string;
  sku?: string;
  categoryId?: ID;
  /** Unidad en la que se controla el stock. */
  unitId?: ID;
  /** Unidad en la que se compra (caja, bolsa...). Si falta, se compra en la unidad de stock. */
  purchaseUnitId?: ID;
  /** 1 unidad de compra = purchaseFactor unidades de stock (p. ej. 1 caja = 12 unidades). */
  purchaseFactor: number;
  locationId?: ID;
  supplierId?: ID;
  alternativeSupplierIds: ID[];
  stock: number;
  minStock: number;
  maxStock: number;
  notes?: string;
  active: boolean;
  externalSystems?: ExternalSystems;
}

export const MOVEMENT_TYPES = ['ingreso', 'salida', 'ajuste', 'conteo', 'devolucion', 'perdida', 'consumo'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export type MovementOrigin = 'manual' | 'conteo' | 'pedido' | 'importacion' | 'sincronizacion' | 'deshacer' | 'alta';
export type SourceSystem = 'local' | ExternalSystemId | 'excel';

export interface StockMovement extends BaseEntity {
  productId: ID;
  type: MovementType;
  quantityBefore: number;
  quantityAfter: number;
  delta: number;
  reason?: string;
  origin: MovementOrigin;
  sourceSystem: SourceSystem;
  /** Clave única: impide aplicar dos veces el mismo movimiento. */
  idempotencyKey: string;
  externalMovementId?: string;
  syncId?: ID;
  /** Referencia al pedido / conteo que lo originó. */
  refId?: ID;
  /**
   * true: el movimiento FIJA la cantidad (ajuste a un valor, conteo).
   * false/ausente: el movimiento SUMA o RESTA `delta`.
   * Permite recalcular el stock de forma determinística cuando llegan movimientos
   * de otros dispositivos (ver recomputeStock).
   */
  absolute?: boolean;
}

export const ORDER_STATUSES = ['borrador', 'pendiente', 'enviado', 'recibido', 'cancelado'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order extends BaseEntity {
  number: number;
  date: ISODate;
  supplierId?: ID;
  status: OrderStatus;
  notes?: string;
  receivedAt?: ISODate;
}

export interface OrderItem extends BaseEntity {
  orderId: ID;
  productId: ID;
  /** Cantidad en unidad de compra. */
  quantity: number;
  /** Factor de conversión a unidad de stock al momento de crear el ítem. */
  factor: number;
  receivedQuantity?: number;
}

export type CountStatus = 'abierto' | 'finalizado' | 'aplicado' | 'descartado';
export type CountBaseline = 'local' | ExternalSystemId;

export interface InventoryCount extends BaseEntity {
  name: string;
  status: CountStatus;
  locationId?: ID;
  categoryId?: ID;
  /** Contra qué stock se compara: el local o el informado por un sistema externo. */
  baseline: CountBaseline;
  finishedAt?: ISODate;
  appliedAt?: ISODate;
}

export interface InventoryCountItem extends BaseEntity {
  countId: ID;
  productId: ID;
  /** Stock esperado al iniciar el conteo (según baseline). */
  expected: number;
  counted?: number;
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type LogoKind = 'default' | 'emoji' | 'image';
export type ModuleKey =
  | 'dashboard' | 'stock' | 'count' | 'orders' | 'products' | 'suppliers' | 'locations' | 'categories'
  | 'units' | 'movements' | 'reconciliation' | 'export' | 'settings' | 'integrations' | 'cloud';

export interface MenuItemSetting {
  key: ModuleKey;
  label: string;
  visible: boolean;
}

export type SuggestionMode = 'toMax' | 'toMin';

export interface Settings extends BaseEntity {
  businessName: string;
  subtitle: string;
  logo: { kind: LogoKind; value?: string };
  primaryColor: string;
  secondaryColor: string;
  theme: ThemeMode;
  menu: MenuItemSetting[];
  /** Por debajo de min * criticalRatio el estado es "Crítico". */
  criticalRatio: number;
  suggestionMode: SuggestionMode;
}

export type IntegrationMode = 'disabled' | 'mock' | 'gateway' | 'excel';
export type IntegrationStatus = 'no_configurado' | 'configurado' | 'conectado' | 'error' | 'desconectado';
export type StockAuthority = 'stockmanager' | 'maxirest' | 'manual';
export type SyncInterval = 'manual' | '15' | '30' | '60';

export interface Integration extends BaseEntity {
  /** = system, una fila por sistema. */
  system: ExternalSystemId;
  mode: IntegrationMode;
  status: IntegrationStatus;
  /** URL pública del gateway propio. No es un secreto. */
  gatewayUrl?: string;
  stockAuthority: StockAuthority;
  syncInterval: SyncInterval;
  lastSyncAt?: ISODate;
  lastError?: string;
}

export type SyncJobStatus = 'pendiente' | 'sincronizado' | 'error';
export type SyncOperation = 'createStockAdjustment' | 'updateInventory' | 'createOrder';

export interface SyncJob extends BaseEntity {
  system: ExternalSystemId;
  operation: SyncOperation;
  status: SyncJobStatus;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  attempts: number;
  /** Mensaje comprensible para el usuario. */
  error?: string;
  /** Detalle técnico (no se muestra salvo en "ver detalle"). */
  technicalError?: string;
}

export type ExternalEntityType = 'product' | 'category' | 'unit' | 'location';

/**
 * Copia local de un registro de un sistema externo (insumo, rubro, unidad, depósito),
 * tal como fue leído en la última sincronización o importación Excel.
 * El vínculo con la entidad local vive en `entity.externalSystems[system]`.
 */
export interface ExternalReference extends BaseEntity {
  system: ExternalSystemId;
  entityType: ExternalEntityType;
  externalId: string;
  code?: string;
  name: string;
  /** Sólo para insumos: stock informado por el sistema externo. */
  stock?: number;
  unitName?: string;
  categoryName?: string;
  locationName?: string;
  source: 'api' | 'mock' | 'excel';
  lastSeenAt: ISODate;
}

export type StockStatus = 'normal' | 'bajo' | 'critico' | 'sin_stock';

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
  /** Código de barras (EAN-13, EAN-8, UPC-A o Code 128 / código interno). Único entre productos. */
  barcode?: string;
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
  /** Receta: al anotar una producción de este producto se descuentan estos insumos. */
  recipe?: Recipe;
}

/** Un insumo de la receta: cantidad (en su unidad de stock) por cada tanda. */
export interface RecipeItem {
  productId: ID;
  quantity: number;
}

/** Receta por tanda: con `items` se obtienen `yield` unidades del producto. */
export interface Recipe {
  yield: number;
  items: RecipeItem[];
}

export const MOVEMENT_TYPES = ['ingreso', 'salida', 'ajuste', 'conteo', 'devolucion', 'perdida', 'consumo', 'produccion'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export type MovementOrigin = 'manual' | 'conteo' | 'pedido' | 'importacion' | 'sincronizacion' | 'deshacer' | 'alta' | 'remito';
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
  /** Usuario que registró el movimiento (copia del nombre para el historial). */
  performedBy?: Actor;
  /** Nombre del producto al momento del movimiento (para el historial si después se elimina). */
  productName?: string;
  /**
   * Punto gastronómico donde ocurre el movimiento. Si falta, es el Depósito Central
   * (el stock de `Product.stock`). El stock de cada punto se calcula con sus movimientos.
   */
  outletId?: ID;
}

/** Quién hizo algo: id del usuario y su nombre en ese momento. */
export interface Actor {
  id: ID;
  name: string;
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
  /** Conteo en un punto gastronómico (si falta, es en el Depósito Central). */
  outletId?: ID;
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
  | 'units' | 'movements' | 'reconciliation' | 'export' | 'settings' | 'integrations' | 'cloud' | 'users' | 'invoices' | 'transfers'
  | 'reports' | 'production';

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
  /** Minutos sin uso tras los que se pide el PIN otra vez (0 = nunca). */
  autoLockMinutes: number;
  /** Módulos fijos en la barra superior de la computadora (el resto va en "Más"). */
  navTop?: ModuleKey[];
  /** Módulos de la barra inferior del celular (hasta 4; "Más" siempre está). */
  navBottom?: ModuleKey[];
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

// ───────────────────────── Usuarios de la app ─────────────────────────

export const PERMISSIONS = [
  'stock.view', 'stock.move', 'count.do', 'count.apply', 'orders.manage', 'orders.receive', 'catalog.manage',
  'movements.view', 'export', 'admin', 'invoices', 'transfers', 'production',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type UserRole = 'admin' | 'manager' | 'staff' | 'production' | 'custom';

/**
 * Usuario interno de la app (nombre + PIN), creado por un administrador.
 * El PIN nunca se guarda: sólo su hash PBKDF2 con sal.
 */
export interface AppUser extends BaseEntity {
  name: string;
  role: UserRole;
  permissions: Permission[];
  pinHash: string;
  pinSalt: string;
  active: boolean;
  color?: string;
  /** Email de la cuenta de la nube con la que entra esta persona (minúsculas). */
  email?: string;
}

// ───────────────────────── Facturas recibidas ─────────────────────────

/** Página (foto) de una factura. La imagen vive aparte, en InvoiceImage. */
export interface InvoicePage {
  id: ID;
  width: number;
  height: number;
  bytes: number;
  /** Miniatura JPEG chica (data URL) para listados. */
  thumb?: string;
}

/** Factura de proveedor: datos para buscarla + fotos. Se sincroniza con la nube. */
export interface Invoice extends BaseEntity {
  /** Fecha de la factura (YYYY-MM-DD). */
  date: string;
  supplierId?: ID;
  orderId?: ID;
  number?: string;
  total?: number;
  notes?: string;
  pages: InvoicePage[];
  createdBy?: Actor;
}

/**
 * Foto de una página de factura (JPEG en base64). Se guarda en el dispositivo y,
 * con la nube activa, se sube aparte y se descarga sólo cuando se abre.
 */
export interface InvoiceImage {
  id: ID;
  invoiceId: ID;
  type: string;
  data: string;
  /** 1 = ya está en la nube (o no hace falta subirla), 0 = pendiente. */
  uploaded: 0 | 1;
}

// ───────────────────────── Puntos y remitos internos ─────────────────────────

/** Punto gastronómico que recibe mercadería del Depósito Central (Parador, Xenote…). */
export interface Outlet extends BaseEntity {
  name: string;
  /** Cómo se llama este depósito/punto en Maxirest (para el Excel de importación). */
  maxirestName?: string;
  active: boolean;
}

export interface TransferItem {
  productId: ID;
  /** Cantidad en unidad de stock. */
  quantity: number;
}

/** pendiente: falta cargarlo en Maxirest · cargado: ya está · no_aplica: anulado antes de cargarlo. */
export type MaxirestLoadStatus = 'pendiente' | 'cargado' | 'no_aplica';

/** Remito interno: mercadería que sale del Depósito Central hacia un punto. */
export interface Transfer extends BaseEntity {
  number: number;
  /** Fecha del remito (YYYY-MM-DD). */
  date: string;
  outletId: ID;
  items: TransferItem[];
  notes?: string;
  status: 'enviado' | 'anulado';
  voidedAt?: ISODate;
  voidedBy?: Actor;
  createdBy?: Actor;
  /** Control de carga manual en Maxirest (no hay API para hacerlo automático). */
  maxirest: MaxirestLoadStatus;
  maxirestAt?: ISODate;
  maxirestBy?: Actor;
}

/**
 * Modelo de datos de Orillas.
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
  /** Costo por unidad de stock cargado a mano (si no hay facturas con precio). */
  cost?: number;
  notes?: string;
  active: boolean;
  externalSystems?: ExternalSystems;
  /** Receta: al anotar una producción de este producto se descuentan estos insumos. */
  recipe?: Recipe;
  /** Plan de producción (panadería): cantidad a producir por fecha YYYY-MM-DD. */
  productionPlan?: Record<string, number>;
  /** Cómo figura en las facturas de los proveedores (aprendido al confirmar renglones leídos con IA). */
  invoiceAliases?: string[];
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

export const MOVEMENT_TYPES = ['ingreso', 'salida', 'ajuste', 'conteo', 'devolucion', 'perdida', 'consumo', 'produccion', 'venta'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export type MovementOrigin = 'manual' | 'conteo' | 'pedido' | 'importacion' | 'sincronizacion' | 'deshacer' | 'alta' | 'remito' | 'factura' | 'asistente' | 'salon';
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
  /** Auditoría: quién empezó, finalizó y aplicó el conteo. */
  createdBy?: Actor;
  finishedBy?: Actor;
  appliedBy?: Actor;
}

export interface InventoryCountItem extends BaseEntity {
  countId: ID;
  productId: ID;
  /** Stock esperado al iniciar el conteo (según baseline). */
  expected: number;
  counted?: number;
  /** Auditoría: quién cargó la cantidad y cuándo. */
  countedBy?: Actor;
  countedAt?: ISODate;
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type LogoKind = 'default' | 'emoji' | 'image';
export type ModuleKey =
  | 'dashboard' | 'stock' | 'count' | 'orders' | 'products' | 'suppliers' | 'locations' | 'categories'
  | 'units' | 'movements' | 'reconciliation' | 'export' | 'settings' | 'integrations' | 'cloud' | 'users' | 'invoices' | 'transfers'
  | 'reports' | 'production' | 'pastry' | 'showcase' | 'diagnostics' | 'salon' | 'kitchen' | 'fiscal' | 'salonConfig';

export interface MenuItemSetting {
  key: ModuleKey;
  label: string;
  visible: boolean;
}

export type SuggestionMode = 'toMax' | 'toMin' | 'byUse';

export interface Settings extends BaseEntity {
  businessName: string;
  /** Encabezado de los tickets impresos: una línea por renglón (si falta, el nombre del negocio). */
  ticketHeader?: string;
  /** Sucursal / local que se imprime debajo del encabezado ("Sucursal: Parador"). */
  sucursal?: string;
  /** Local "de antes": los registros del Salón sin local (creados antes de tener locales) son de este. */
  defaultOutletId?: ID;
  subtitle: string;
  logo: { kind: LogoKind; value?: string };
  primaryColor: string;
  secondaryColor: string;
  theme: ThemeMode;
  menu: MenuItemSetting[];
  /** Por debajo de min * criticalRatio el estado es "Crítico". */
  criticalRatio: number;
  suggestionMode: SuggestionMode;
  /** Pedido según consumo: para cuántos días pedir (si falta: 7). */
  suggestionDays?: number;
  /** Minutos sin uso tras los que se pide el PIN otra vez (0 = nunca). */
  autoLockMinutes: number;
  /** Módulos fijos en la barra superior de la computadora (el resto va en "Más"). */
  navTop?: ModuleKey[];
  /** Módulos de la barra inferior del celular (hasta 4; "Más" siempre está). */
  navBottom?: ModuleKey[];
  /**
   * Familias que aparecen en Producción (panadería, pastelería…). Si falta, se usan las que
   * se llaman parecido a "Panadería" o "Pastelería".
   */
  productionCategoryIds?: ID[];
  /** Familias que se ven en Pastelería (si falta: las que se llaman pastelería o repostería). */
  pastryCategoryIds?: ID[];
  /** Dirección del servidor que lee facturas con IA (Cloudflare Worker). */
  aiReaderUrl?: string;
  /** Facturación electrónica ARCA (los certificados NO están acá: están en el servidor). */
  fiscal?: FiscalSettings;
  /**
   * Orillas es independiente: Maxirest no aparece en ningún lado salvo que se active
   * la conexión opcional en Configuración → Integraciones.
   */
  maxirest?: boolean;
  /** Descontar del stock las recetas de la carta al cerrar cada pedido (si falta: sí). */
  salonStock?: boolean;
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
  'movements.view', 'export', 'admin', 'invoices', 'transfers', 'production', 'recipes', 'pastry', 'salon', 'billing',
  'sales.edit', 'sales.void',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type UserRole = 'admin' | 'manager' | 'staff' | 'production' | 'pastry' | 'waiter' | 'custom';

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
  /** Locales donde trabaja (vacío o sin definir: todos). */
  outletIds?: ID[];
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
  /** Renglones leídos de la foto (con IA) y revisados. */
  items?: InvoiceItem[];
  /** Cuándo se leyó con IA, y avisos de la lectura (algo borroso, descuento general…). */
  aiReadAt?: string;
  aiWarnings?: string[];
  /** Cuándo y quién cargó los renglones al stock (ingresos con origen "factura"). */
  stockAppliedAt?: string;
  stockAppliedBy?: Actor;
  /** Movimientos de ingreso que generó la carga (para deshacerla). */
  stockMovementIds?: ID[];
  /** Marcada como ya cargada: la mercadería había entrado antes (p. ej. por remito con el asistente). */
  stockElsewhere?: boolean;
  /** Cómo y cuándo se paga (eCheq a N días, efectivo, transferencia) y si ya se pagó. */
  payment?: InvoicePayment;
}

export const PAYMENT_METHODS = ['echeq', 'efectivo', 'transferencia'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface InvoicePayment {
  method?: PaymentMethod;
  /** eCheq: a cuántos días (desde la fecha de la factura). */
  days?: number;
  paid: boolean;
  /** Fecha en que se pagó (YYYY-MM-DD). */
  paidAt?: string;
  updatedAt: string;
  updatedBy?: Actor;
}

/**
 * Renglón de una factura: lo que dice la factura y a qué producto del catálogo corresponde.
 * `stockQty` es la cantidad en la unidad de stock del producto (p. ej. 2 cajas × 12 = 24 u).
 */
export interface InvoiceItem {
  id: ID;
  description: string;
  code?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  lineTotal?: number;
  productId?: ID;
  stockQty?: number;
  /** Unidades de stock que trae cada caja/bulto (si el renglón viene en cajas o bultos). */
  packSize?: number;
  /** ok: reconocido seguro · check: revisar · none: sin producto · ignored: no va al stock. */
  status: 'ok' | 'check' | 'none' | 'ignored';
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
  /** Nombre del local (sale como "Sucursal: …" en los tickets). */
  name: string;
  /** Número de local / sucursal (como en Maxirest). */
  code?: string;
  /** Punto de venta de ARCA de este local (cada local factura con el suyo y su numeración). */
  ptoVta?: number;
  /** Encabezado propio de los tickets de este local (renglones); si falta, el general. */
  ticketHeader?: string;
  /** Cómo se llama este depósito/punto en Maxirest (para el Excel de importación). */
  maxirestName?: string;
  active: boolean;
  /** Familias que maneja el punto: sus productos aparecen en el stock del punto (aunque estén en 0) y se cuentan. */
  categoryIds?: ID[];
  /** Mínimo de cada producto en este punto (productId → cantidad): por debajo, avisa que falta. */
  minStock?: Record<ID, number>;
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

// ───────────────────────── Registro de ingresos ─────────────────────────

export type AccessKind = 'ingreso' | 'apertura' | 'salida';

/** Una vez que alguien entró (o abrió, o cerró) la app en un dispositivo. */
export interface AccessEntry {
  id: string;
  /** Cuándo (ISO). */
  at: ISODate;
  kind: AccessKind;
  userId: string;
  userName: string;
  email?: string;
  /** Descripción legible del dispositivo, p. ej. "Android · Chrome · app instalada". */
  device: string;
  /** Identificador del dispositivo (al azar, guardado en el navegador). */
  deviceId: string;
  /** Sólo local: 1 cuando ya se subió a la nube. */
  pushed?: 0 | 1;
}

// ───────────────────────── Salón: mesas, carta y pedidos ─────────────────────────

export interface DiningTable extends BaseEntity {
  /** Local (sucursal) al que pertenece: cada local tiene sus mesas, carta, ventas, caja y comprobantes. */
  outletId?: ID;
  name: string;
  /** Sector: "Salón", "Terraza", "Barra"… */
  zone: string;
  seats?: number;
  /** Orden en la lista. */
  order: number;
  active: boolean;
  /** Posición en el plano del sector, en % del ancho y alto (0–100). */
  x?: number;
  y?: number;
  shape?: TableShape;
  /** 1 chica, 2 mediana, 3 grande. */
  size?: 1 | 2 | 3;
}

export type TableShape = 'cuadrada' | 'redonda' | 'rectangular';

/** Adicional de un plato ("leche de almendras", "extra queso"): suma al precio. */
export interface MenuExtra {
  name: string;
  price: number;
}

/** Plato o bebida de la carta (lo que se vende; no es un producto de stock). */
export interface MenuItem extends BaseEntity {
  /** Local (sucursal) al que pertenece: cada local tiene sus mesas, carta, ventas, caja y comprobantes. */
  outletId?: ID;
  name: string;
  /** Sección de la carta: "Desayunos", "Bebidas", "Principales"… */
  section: string;
  price: number;
  /** @deprecated Ya no se usa (el Salón no depende de Maxirest); queda en datos viejos. */
  maxirestCode?: string;
  /** Va a la pantalla de cocina (las bebidas suelen salir directo). */
  kitchen: boolean;
  /** Alícuota de IVA incluida en el precio (si falta, la de la configuración fiscal). */
  iva?: IvaRate;
  /** Adicionales que se pueden elegir al pedirlo. */
  extras?: MenuExtra[];
  /**
   * Receta para descontar stock al vender: qué insumos (o productos elaborados) lleva cada
   * porción (`yield` porciones por tanda; en la carta casi siempre 1).
   */
  recipe?: Recipe;
  /** Dónde se prepara (si va a la pantalla): cocina (por defecto) o barra. */
  station?: Station;
  active: boolean;
}

/** Puesto que prepara el plato: cada uno ve sus comandas en su pantalla. */
export type Station = 'cocina' | 'barra';

export type TicketStatus = 'abierta' | 'cuenta' | 'cerrada' | 'anulada';
/** nuevo → (enviar) cocina → listo → entregado. Lo que no va a cocina pasa directo a entregado. */
export type TicketLineStatus = 'nuevo' | 'cocina' | 'listo' | 'entregado';

export interface TicketLine {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
  notes?: string;
  kitchen: boolean;
  status: TicketLineStatus;
  sentAt?: ISODate;
  readyAt?: ISODate;
  by?: { id: string; name: string };
  /** Adicionales elegidos (su precio ya está sumado en `price`). */
  extras?: MenuExtra[];
  /** Cortesía: no se cobra. */
  comp?: boolean;
  /** Ítem libre (envío, varios): no es de la carta. */
  custom?: boolean;
  /** Dónde se prepara (si falta: cocina). */
  station?: Station;
}

/** De dónde viene el pedido. */
export type TicketChannel = 'mesa' | 'mostrador' | 'llevar' | 'delivery';

export interface TicketDiscount {
  kind: 'pct' | 'monto';
  value: number;
  reason?: string;
}

/** Un cobro de la cuenta (toda o una parte, si se divide). */
export interface TicketCharge {
  id: string;
  at: ISODate;
  /** Lo que se cobró de la cuenta (sin propina). */
  amount: number;
  payments: Payment[];
  tip?: { amount: number; method: SalePaymentMethod };
  /** "1 de 3", "Por ítems"… */
  label?: string;
  /** Si se dividió por ítems: qué se pagó. */
  items?: { lineId: string; qty: number }[];
  fiscalDocId?: string;
  /** Se cobró sin factura (queda para facturar después). */
  fiscalPending?: boolean;
  cashSessionId?: string;
  by?: { id: string; name: string };
}

/** El pedido de una mesa, desde que se abre hasta que se cierra. */
export interface TableTicket extends BaseEntity {
  /** Local (sucursal) al que pertenece: cada local tiene sus mesas, carta, ventas, caja y comprobantes. */
  outletId?: ID;
  tableId: string;
  tableName: string;
  number: number;
  openedAt: ISODate;
  openedBy?: { id: string; name: string };
  guests?: number;
  status: TicketStatus;
  lines: TicketLine[];
  closedAt?: ISODate;
  total: number;
  /** @deprecated Ya no se usa (el Salón no depende de Maxirest); queda en datos viejos. */
  maxirest?: { status: 'pendiente' | 'enviado' | 'error'; at?: ISODate; error?: string };
  /** Cobro de la mesa. */
  payments?: Payment[];
  paidAt?: ISODate;
  /** Comprobante fiscal de la mesa (si se facturó en Orillas). */
  fiscalDocId?: string;
  /** Se cerró sin factura todavía (p. ej. ARCA caída): queda para facturar después. */
  fiscalPending?: boolean;
  /** Mesa (por defecto), mostrador, para llevar o delivery. */
  channel?: TicketChannel;
  /** Cliente de mostrador / para llevar / delivery. */
  customer?: { name?: string; phone?: string; address?: string };
  /** Suma de lo pedido antes del descuento. */
  subtotal?: number;
  discount?: TicketDiscount;
  /** Cobros (uno, o varios si se dividió la cuenta). */
  charges?: TicketCharge[];
  /** Cambios hechos después de cerrar la venta (quién, cuándo, qué y por qué). */
  edits?: SaleEdit[];
}

/** Un cambio a una venta cerrada: medio de pago, datos, reabrir o anular (siempre con motivo). */
export interface SaleEdit {
  at: ISODate;
  by?: { id: string; name: string };
  action: 'pagos' | 'datos' | 'reabierta' | 'anulada';
  reason: string;
  detail?: string;
}

// ───────────────────────── Caja ─────────────────────────

/** Turno de caja: se abre con el efectivo inicial y se cierra contando cada medio de pago. */
export interface CashSession extends BaseEntity {
  /** Local (sucursal) al que pertenece: cada local tiene sus mesas, carta, ventas, caja y comprobantes. */
  outletId?: ID;
  number: number;
  register: string;
  openedAt: ISODate;
  openedBy?: { id: string; name: string };
  /** Efectivo con el que se abre. */
  initialCash: number;
  status: 'abierta' | 'cerrada';
  closedAt?: ISODate;
  closedBy?: { id: string; name: string };
  /** Lo que el sistema esperaba y lo que se contó, por medio de pago (al cerrar). */
  expected?: Partial<Record<SalePaymentMethod, number>>;
  counted?: Partial<Record<SalePaymentMethod, number>>;
  note?: string;
}

export interface CashMovement extends BaseEntity {
  /** Local (sucursal) al que pertenece: cada local tiene sus mesas, carta, ventas, caja y comprobantes. */
  outletId?: ID;
  sessionId: string;
  at: ISODate;
  kind: 'ingreso' | 'egreso';
  amount: number;
  method: SalePaymentMethod;
  reason: string;
  by?: { id: string; name: string };
  /** Cobranza de una cuenta corriente: el cliente que pagó. */
  accountId?: string;
  accountName?: string;
}

// ───────────────────────── Facturación electrónica (ARCA) ─────────────────────────

export type IvaRate = 0 | 2.5 | 5 | 10.5 | 21 | 27;
export type FiscalAmbiente = 'homologacion' | 'produccion';
/** Condición del EMISOR frente al IVA. */
export type EmisorCondicion = 'RI' | 'MONO' | 'EXENTO';

export interface FiscalSettings {
  enabled: boolean;
  /** Dirección del servicio de ARCA (Cloudflare Worker). */
  serviceUrl: string;
  ambiente: FiscalAmbiente;
  cuit: string;
  razonSocial: string;
  nombreFantasia?: string;
  domicilio: string;
  condicionIva: EmisorCondicion;
  /** Punto de venta "Web Services" dado de alta en ARCA sólo para Orillas. */
  ptoVta: number;
  iibb?: string;
  /** Inicio de actividades, AAAA-MM-DD. */
  inicioActividades?: string;
  /** 1 productos, 2 servicios, 3 ambos. */
  concepto: 1 | 2 | 3;
  ivaDefault: IvaRate;
  /** Responsables inscriptos nuevos pueden tener que emitir "M" en lugar de "A". */
  letraA: 'A' | 'M';
  /** Pie del ticket (opcional). */
  pie?: string;
}

/**
 * Medios de cobro. Los de plata (efectivo…otro) entran en la caja; `cuenta_corriente` deja la
 * deuda en la cuenta de un cliente y `invitacion` cierra sin cobrar (consumo interno): ninguno de
 * los dos entra en la caja ni en el arqueo.
 */
export type SalePaymentMethod = 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'qr' | 'otro' | 'cuenta_corriente' | 'invitacion';
export interface Payment {
  method: SalePaymentMethod;
  amount: number;
  /** Efectivo entregado (para calcular el vuelto). */
  received?: number;
  /** Cuenta corriente: a qué cliente se le carga. */
  accountId?: string;
  accountName?: string;
  /** Invitación / consumo interno: motivo (obligatorio). */
  note?: string;
}

/** Cliente de cuenta corriente (ALADES, socios, huéspedes, personal…). */
export interface CustomerAccount extends BaseEntity {
  name: string;
  /** Para facturarle: documento y condición frente al IVA (opcionales). */
  docTipo?: DocTipo;
  docNro?: string;
  condicionIva?: number;
  notes?: string;
  active: boolean;
}

export type FiscalKind = 'factura' | 'nc' | 'nd';
export type FiscalLetter = 'A' | 'B' | 'C' | 'M';
/** borrador → enviando → autorizada | rechazada | incierta (se reintenta consultando) | error */
export type FiscalStatus = 'borrador' | 'enviando' | 'autorizada' | 'rechazada' | 'incierta' | 'error';
export type DocTipo = 80 | 86 | 96 | 99;

export interface FiscalReceptor {
  docTipo: DocTipo;
  docNro: string;
  nombre?: string;
  domicilio?: string;
  /** Id de condición frente al IVA de ARCA (5 = Consumidor Final). */
  condicionIva: number;
}

export interface FiscalLine {
  name: string;
  qty: number;
  /** Precio unitario final (IVA incluido). */
  unitPrice: number;
  iva: IvaRate;
  /** qty × unitPrice, redondeado. */
  total: number;
}

export interface FiscalEmisor {
  cuit: string;
  razonSocial: string;
  nombreFantasia?: string;
  domicilio: string;
  condicionIva: EmisorCondicion;
  iibb?: string;
  inicioActividades?: string;
}

/** Comprobante fiscal electrónico. Una vez autorizado no se modifica (las reglas de la nube lo impiden). */
export interface FiscalDoc extends BaseEntity {
  /** Local (sucursal) al que pertenece: cada local tiene sus mesas, carta, ventas, caja y comprobantes. */
  outletId?: ID;
  kind: FiscalKind;
  letra: FiscalLetter;
  cbteTipo: number;
  ptoVta: number;
  ambiente: FiscalAmbiente;
  concepto: 1 | 2 | 3;
  emisor: FiscalEmisor;
  receptor: FiscalReceptor;
  lines: FiscalLine[];
  impTotal: number;
  impNeto: number;
  impIva: number;
  impTotConc: number;
  impOpEx: number;
  impTrib: number;
  iva: { id: number; rate: IvaRate; baseImp: number; importe: number }[];
  /** Bonificación: diferencia entre lo pedido (líneas) y el total facturado (descuentos). */
  bonif?: number;
  status: FiscalStatus;
  /** Número que se va a pedir, anotado ANTES de enviar (para no duplicar si se corta). */
  attempt?: { nro: number; fecha: string; at: ISODate };
  /** Número y fecha (AAAAMMDD) autorizados. */
  nro?: number;
  fecha?: string;
  cae?: string;
  /** Vencimiento del CAE, AAAAMMDD. */
  caeVto?: string;
  authorizedAt?: ISODate;
  obs?: { code?: number; msg?: string }[];
  errors?: { code?: number; msg?: string }[];
  message?: string;
  ticketId?: string;
  tableName?: string;
  payments?: Payment[];
  asociado?: { docId?: string; cbteTipo: number; ptoVta: number; nro: number; fecha?: string };
  createdBy?: { id: string; name: string };
}

/** Registro de cada pedido y respuesta de ARCA (auditoría). Sólo se agrega, nunca se modifica. */
export interface FiscalLogEntry extends BaseEntity {
  docId?: string;
  at: ISODate;
  op: string;
  ms?: number;
  status?: number;
  request?: string;
  response?: string;
  error?: string;
  result?: string;
  by?: string;
}

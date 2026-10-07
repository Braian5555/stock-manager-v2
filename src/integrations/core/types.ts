/**
 * Integration Layer — contrato neutral entre Stock Manager y sistemas externos.
 *
 *   Stock Manager  →  Integration Layer  →  Adapter (Mock | Maxirest Gateway | …)
 *
 * Cada adaptador declara qué operaciones soporta. Las que no soporta lanzan
 * IntegrationError("NOT_SUPPORTED"): nunca se simula que funcionan.
 */

export const CAPABILITIES = [
  'getProducts', 'getCategories', 'getUnits', 'getLocations', 'getStock', 'getMovements', 'getInventory',
  'createStockAdjustment', 'updateInventory', 'createOrder',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABEL: Record<Capability, string> = {
  getProducts: 'Leer insumos / productos',
  getCategories: 'Leer rubros / familias',
  getUnits: 'Leer unidades de medida',
  getLocations: 'Leer depósitos / ubicaciones',
  getStock: 'Leer stock',
  getMovements: 'Leer movimientos de stock',
  getInventory: 'Leer inventarios',
  createStockAdjustment: 'Crear ajuste de stock',
  updateInventory: 'Actualizar inventario',
  createOrder: 'Crear pedido / orden de compra',
};

/**
 * supported           → probado y disponible en este adaptador.
 * not_supported       → el sistema no lo ofrece (o no está documentado oficialmente).
 * pending_enablement  → podría existir, pero requiere habilitación/confirmación del proveedor.
 */
export type CapabilityStatus = 'supported' | 'not_supported' | 'pending_enablement';
export type CapabilityMap = Record<Capability, CapabilityStatus>;

export type AdapterKind = 'mock' | 'real';

export type IntegrationErrorCode = 'NOT_SUPPORTED' | 'NOT_CONFIGURED' | 'OFFLINE' | 'NETWORK' | 'AUTH' | 'SERVER' | 'VALIDATION' | 'UNKNOWN';

export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly technical?: string;
  constructor(code: IntegrationErrorCode, message?: string, technical?: string) {
    super(message ?? code);
    this.name = 'IntegrationError';
    this.code = code;
    this.technical = technical;
  }
}

export const notSupported = (capability: Capability, system = 'el sistema externo') =>
  new IntegrationError('NOT_SUPPORTED', `"${CAPABILITY_LABEL[capability]}" no está disponible en ${system}.`);

// ─── Datos externos normalizados ───
export interface ExternalProduct {
  externalId: string;
  code?: string;
  name: string;
  categoryExternalId?: string;
  categoryName?: string;
  unitName?: string;
  locationExternalId?: string;
  locationName?: string;
}
export interface ExternalNamed {
  externalId: string;
  code?: string;
  name: string;
}
export interface ExternalStock {
  productExternalId: string;
  locationExternalId?: string;
  quantity: number;
}
export interface ExternalMovement {
  externalId: string;
  productExternalId: string;
  delta: number;
  date: string;
  concept?: string;
}
export interface ExternalInventoryLine {
  productExternalId: string;
  expected: number;
  counted?: number;
}

export interface StockAdjustmentRequest {
  /** Clave idempotente: el adaptador / gateway debe rechazar repeticiones. */
  idempotencyKey: string;
  productExternalId: string;
  locationExternalId?: string;
  newQuantity: number;
  delta: number;
  reason?: string;
}
export interface InventoryUpdateRequest {
  idempotencyKey: string;
  locationExternalId?: string;
  lines: { productExternalId: string; counted: number }[];
}
export interface OrderRequest {
  idempotencyKey: string;
  supplierName?: string;
  lines: { productExternalId: string; quantity: number }[];
}
export interface WriteResult {
  externalId?: string;
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
}

export interface IntegrationAdapter {
  readonly id: string;
  readonly kind: AdapterKind;
  readonly label: string;
  /** Texto visible siempre que el adaptador está activo (p. ej. "Modo demostración"). */
  readonly banner?: string;
  capabilities(): Promise<CapabilityMap>;
  testConnection(): Promise<ConnectionResult>;
  getProducts(): Promise<ExternalProduct[]>;
  getCategories(): Promise<ExternalNamed[]>;
  getUnits(): Promise<ExternalNamed[]>;
  getLocations(): Promise<ExternalNamed[]>;
  getStock(): Promise<ExternalStock[]>;
  getMovements(since?: string): Promise<ExternalMovement[]>;
  getInventory(locationExternalId?: string): Promise<ExternalInventoryLine[]>;
  createStockAdjustment(req: StockAdjustmentRequest): Promise<WriteResult>;
  updateInventory(req: InventoryUpdateRequest): Promise<WriteResult>;
  createOrder(req: OrderRequest): Promise<WriteResult>;
}

/** Base: todo NOT_SUPPORTED. Los adaptadores sólo sobrescriben lo que de verdad soportan. */
export abstract class BaseAdapter implements IntegrationAdapter {
  abstract readonly id: string;
  abstract readonly kind: AdapterKind;
  abstract readonly label: string;
  readonly banner?: string;
  abstract capabilities(): Promise<CapabilityMap>;
  abstract testConnection(): Promise<ConnectionResult>;
  protected fail(c: Capability): never {
    throw notSupported(c, this.label);
  }
  async getProducts(): Promise<ExternalProduct[]> { return this.fail('getProducts'); }
  async getCategories(): Promise<ExternalNamed[]> { return this.fail('getCategories'); }
  async getUnits(): Promise<ExternalNamed[]> { return this.fail('getUnits'); }
  async getLocations(): Promise<ExternalNamed[]> { return this.fail('getLocations'); }
  async getStock(): Promise<ExternalStock[]> { return this.fail('getStock'); }
  async getMovements(_since?: string): Promise<ExternalMovement[]> { return this.fail('getMovements'); }
  async getInventory(_location?: string): Promise<ExternalInventoryLine[]> { return this.fail('getInventory'); }
  async createStockAdjustment(_req: StockAdjustmentRequest): Promise<WriteResult> { return this.fail('createStockAdjustment'); }
  async updateInventory(_req: InventoryUpdateRequest): Promise<WriteResult> { return this.fail('updateInventory'); }
  async createOrder(_req: OrderRequest): Promise<WriteResult> { return this.fail('createOrder'); }
}

export const allCapabilities = (status: CapabilityStatus): CapabilityMap =>
  Object.fromEntries(CAPABILITIES.map((c) => [c, status])) as CapabilityMap;

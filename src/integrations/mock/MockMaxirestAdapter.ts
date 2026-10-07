import {
  BaseAdapter, CAPABILITIES, IntegrationError,
  type CapabilityMap, type ConnectionResult, type ExternalMovement, type ExternalNamed, type ExternalProduct, type ExternalStock,
  type ExternalInventoryLine, type InventoryUpdateRequest, type StockAdjustmentRequest, type WriteResult,
} from '../core/types';

/**
 * MAXIREST SIMULADO — sólo para demostración y pruebas.
 * No se conecta a ningún servidor. Los datos son inventados y genéricos.
 * La UI muestra siempre el aviso "Modo demostración — Maxirest simulado".
 */
const STORAGE_KEY = 'sm.mock-maxirest.v1';

interface MockState {
  stock: Record<string, number>;
  applied: string[];
  movementSeq: number;
  movements: ExternalMovement[];
  fail: boolean;
}

const RUBROS: ExternalNamed[] = [
  { externalId: 'R1', code: '1', name: 'Bebidas' },
  { externalId: 'R2', code: '2', name: 'Carnes' },
  { externalId: 'R3', code: '3', name: 'Verduras' },
  { externalId: 'R4', code: '4', name: 'Limpieza' },
  { externalId: 'R5', code: '5', name: 'Almacén' },
  { externalId: 'R6', code: '6', name: 'Hielo' },
];
const DEPOSITOS: ExternalNamed[] = [
  { externalId: 'D1', code: '1', name: 'Depósito central' },
  { externalId: 'D2', code: '2', name: 'Cámara de frío' },
  { externalId: 'D3', code: '3', name: 'Barra' },
];
const UNIDADES: ExternalNamed[] = [
  { externalId: 'U1', code: 'UN', name: 'Unidad' },
  { externalId: 'U2', code: 'KG', name: 'Kilogramo' },
  { externalId: 'U3', code: 'LT', name: 'Litro' },
  { externalId: 'U4', code: 'BOL', name: 'Bolsa' },
];
// [id, código, nombre, rubro, unidad, depósito, stock inicial]
const INSUMOS: [string, string, string, string, string, string, number][] = [
  ['I1001', 'BEB-001', 'Agua mineral 500 ml', 'R1', 'Unidad', 'D1', 50],
  ['I1002', 'BEB-002', 'Gaseosa cola 1,5 L', 'R1', 'Unidad', 'D1', 10],
  ['I1003', 'HIE-010', 'Hielo 10 kg', 'R6', 'Bolsa', 'D2', 5],
  ['I1004', 'HIE-005', 'Hielo 5 kg', 'R6', 'Bolsa', 'D2', 12],
  ['I1005', 'CAR-001', 'Carne picada', 'R2', 'Kilogramo', 'D2', 4],
  ['I1006', 'CAR-002', 'Pechuga de pollo', 'R2', 'Kilogramo', 'D2', 14],
  ['I1007', 'VER-001', 'Papa', 'R3', 'Kilogramo', 'D2', 3],
  ['I1008', 'VER-002', 'Tomate', 'R3', 'Kilogramo', 'D2', 9],
  ['I1009', 'LIM-001', 'Detergente 5 L', 'R4', 'Unidad', 'D1', 2],
  ['I1010', 'ALM-001', 'Harina 000', 'R5', 'Kilogramo', 'D1', 20],
  ['I1011', 'ALM-002', 'Aceite de girasol 900 ml', 'R5', 'Unidad', 'D1', 7],
  ['I1012', 'VER-010', 'Limón', 'R3', 'Kilogramo', 'D2', 6],
];

function initialState(): MockState {
  return { stock: Object.fromEntries(INSUMOS.map((i) => [i[0], i[6]])), applied: [], movementSeq: 1, movements: [], fail: false };
}

function load(): MockState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return { ...initialState(), ...JSON.parse(raw) };
  } catch {
    /* almacenamiento no disponible: se usa memoria */
  }
  return initialState();
}

export class MockMaxirestAdapter extends BaseAdapter {
  readonly id = 'maxirest-mock';
  readonly kind = 'mock' as const;
  readonly label = 'Maxirest (simulado)';
  readonly banner = 'Modo demostración — Maxirest simulado. Ningún dato se envía a Maxirest.';
  private state: MockState = load();
  private latencyMs: number;

  constructor(opts: { latencyMs?: number } = {}) {
    super();
    this.latencyMs = opts.latencyMs ?? 250;
  }

  private save() {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* ignorar */
    }
  }

  private async call<T>(fn: () => T): Promise<T> {
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.state.fail) throw new IntegrationError('SERVER', 'Simulación de caída', 'HTTP 503 (simulado)');
    return fn();
  }

  /** Para probar la cola de sincronización: simula que Maxirest no responde. */
  setSimulatedFailure(fail: boolean) {
    this.state.fail = fail;
    this.save();
  }
  get simulatedFailure() {
    return this.state.fail;
  }
  reset() {
    this.state = initialState();
    this.save();
  }

  async capabilities(): Promise<CapabilityMap> {
    const map = Object.fromEntries(CAPABILITIES.map((c) => [c, 'supported'])) as CapabilityMap;
    // El mock también demuestra cómo se ve una operación no soportada.
    map.createOrder = 'not_supported';
    return map;
  }

  testConnection(): Promise<ConnectionResult> {
    return this.call(() => ({ ok: true, message: 'Conexión simulada correcta (no es una conexión real).' }));
  }

  getProducts(): Promise<ExternalProduct[]> {
    return this.call(() =>
      INSUMOS.map(([externalId, code, name, rubro, unitName, dep]) => ({
        externalId, code, name, unitName,
        categoryExternalId: rubro, categoryName: RUBROS.find((r) => r.externalId === rubro)?.name,
        locationExternalId: dep, locationName: DEPOSITOS.find((d) => d.externalId === dep)?.name,
      })),
    );
  }
  getCategories() { return this.call(() => RUBROS); }
  getUnits() { return this.call(() => UNIDADES); }
  getLocations() { return this.call(() => DEPOSITOS); }
  getStock(): Promise<ExternalStock[]> {
    return this.call(() =>
      INSUMOS.map(([id, , , , , dep]) => ({ productExternalId: id, locationExternalId: dep, quantity: this.state.stock[id] ?? 0 })),
    );
  }
  getMovements(since?: string): Promise<ExternalMovement[]> {
    return this.call(() => this.state.movements.filter((m) => !since || m.date > since));
  }
  getInventory(location?: string): Promise<ExternalInventoryLine[]> {
    return this.call(() =>
      INSUMOS.filter((i) => !location || i[5] === location).map(([id]) => ({ productExternalId: id, expected: this.state.stock[id] ?? 0 })),
    );
  }
  createStockAdjustment(req: StockAdjustmentRequest): Promise<WriteResult> {
    return this.call(() => {
      if (!(req.productExternalId in this.state.stock)) throw new IntegrationError('VALIDATION', 'El insumo no existe en Maxirest (simulado).');
      const extId = `MOV-${req.idempotencyKey}`;
      if (this.state.applied.includes(req.idempotencyKey)) return { externalId: extId }; // idempotente
      const before = this.state.stock[req.productExternalId];
      this.state.stock[req.productExternalId] = req.newQuantity;
      this.state.applied.push(req.idempotencyKey);
      this.state.movements.push({ externalId: extId, productExternalId: req.productExternalId, delta: req.newQuantity - before, date: new Date().toISOString(), concept: req.reason ?? 'Ajuste' });
      this.save();
      return { externalId: extId };
    });
  }
  updateInventory(req: InventoryUpdateRequest): Promise<WriteResult> {
    return this.call(() => {
      if (this.state.applied.includes(req.idempotencyKey)) return { externalId: `INV-${req.idempotencyKey}` };
      for (const l of req.lines) if (l.productExternalId in this.state.stock) this.state.stock[l.productExternalId] = l.counted;
      this.state.applied.push(req.idempotencyKey);
      this.save();
      return { externalId: `INV-${req.idempotencyKey}` };
    });
  }

  /** Simula una venta/consumo registrado en Maxirest (para probar importación de movimientos). */
  simulateConsumption(productExternalId: string, qty: number) {
    this.state.stock[productExternalId] = (this.state.stock[productExternalId] ?? 0) - qty;
    this.state.movements.push({ externalId: `MOV-SIM-${this.state.movementSeq++}`, productExternalId, delta: -qty, date: new Date().toISOString(), concept: 'Consumo (simulado)' });
    this.save();
  }
}

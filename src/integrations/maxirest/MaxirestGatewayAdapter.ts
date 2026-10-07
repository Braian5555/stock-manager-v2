import {
  allCapabilities, BaseAdapter, CAPABILITIES, IntegrationError,
  type Capability, type CapabilityMap, type CapabilityStatus, type ConnectionResult, type ExternalInventoryLine, type ExternalMovement,
  type ExternalNamed, type ExternalProduct, type ExternalStock, type InventoryUpdateRequest, type OrderRequest,
  type StockAdjustmentRequest, type WriteResult,
} from '../core/types';
import { isOnline } from '../core/errors';

/**
 * Adaptador REAL para Maxirest a través de un Integration Gateway propio.
 *
 *   PWA  →  Gateway (backend propio: Vercel / Cloudflare / Render / Railway / servidor)  →  Maxirest
 *
 * IMPORTANTE:
 *  - Las rutas /v1/... son el contrato DEL GATEWAY DE STOCK MANAGER (docs/maxirest.md),
 *    NO endpoints de Maxirest. Maxirest no publica una API documentada.
 *  - El gateway declara qué puede hacer en GET /v1/maxirest/capabilities. Sin gateway,
 *    o si el gateway no declara una operación, la operación es NOT_SUPPORTED.
 *  - El frontend nunca envía ni guarda credenciales. La autenticación con Maxirest
 *    (si Maxirest la habilita) vive sólo en el gateway.
 */
export class MaxirestGatewayAdapter extends BaseAdapter {
  readonly id = 'maxirest-gateway';
  readonly kind = 'real' as const;
  readonly label = 'Maxirest';
  private caps?: CapabilityMap;

  constructor(private readonly baseUrl: string | undefined, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    super();
  }

  private url(path: string): string {
    if (!this.baseUrl) throw new IntegrationError('NOT_CONFIGURED');
    const u = new URL(this.baseUrl);
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname))
      throw new IntegrationError('VALIDATION', 'El gateway debe usar HTTPS.');
    return `${this.baseUrl.replace(/\/+$/, '')}/v1/maxirest${path}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!isOnline()) throw new IntegrationError('OFFLINE');
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path), {
        ...init,
        credentials: 'include',
        headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
      });
    } catch (e) {
      if (e instanceof IntegrationError) throw e;
      throw new IntegrationError('NETWORK', 'No se pudo contactar al gateway.', String(e));
    }
    if (res.status === 401 || res.status === 403) throw new IntegrationError('AUTH', undefined, `HTTP ${res.status}`);
    if (res.status === 501) throw new IntegrationError('NOT_SUPPORTED', 'El gateway informa que la operación no está habilitada en Maxirest.', 'HTTP 501');
    if (res.status === 422 || res.status === 400) {
      const body = await res.json().catch(() => ({}));
      throw new IntegrationError('VALIDATION', typeof body?.message === 'string' ? body.message : 'Datos rechazados por el sistema externo.', `HTTP ${res.status}`);
    }
    if (!res.ok) throw new IntegrationError('SERVER', undefined, `HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async capabilities(): Promise<CapabilityMap> {
    if (!this.baseUrl) return allCapabilities('not_supported');
    if (this.caps) return this.caps;
    const raw = await this.request<{ capabilities?: Partial<Record<string, CapabilityStatus>> }>('/capabilities');
    const map = allCapabilities('not_supported');
    for (const c of CAPABILITIES) {
      const v = raw.capabilities?.[c];
      if (v === 'supported' || v === 'pending_enablement') map[c] = v;
    }
    this.caps = map;
    return map;
  }

  private async ensure(c: Capability) {
    const caps = await this.capabilities();
    if (caps[c] !== 'supported') this.fail(c);
  }

  async testConnection(): Promise<ConnectionResult> {
    if (!this.baseUrl) return { ok: false, message: 'Falta la URL del gateway de integración.' };
    const health = await this.request<{ ok?: boolean; maxirest?: string }>('/health');
    this.caps = undefined;
    const caps = await this.capabilities();
    const n = Object.values(caps).filter((v) => v === 'supported').length;
    return {
      ok: !!health.ok,
      message: health.ok ? `Gateway disponible. Operaciones habilitadas: ${n} de ${CAPABILITIES.length}.` : 'El gateway respondió, pero informa que Maxirest no está disponible.',
    };
  }

  async getProducts() { await this.ensure('getProducts'); return this.request<ExternalProduct[]>('/products'); }
  async getCategories() { await this.ensure('getCategories'); return this.request<ExternalNamed[]>('/categories'); }
  async getUnits() { await this.ensure('getUnits'); return this.request<ExternalNamed[]>('/units'); }
  async getLocations() { await this.ensure('getLocations'); return this.request<ExternalNamed[]>('/locations'); }
  async getStock() { await this.ensure('getStock'); return this.request<ExternalStock[]>('/stock'); }
  async getMovements(since?: string) {
    await this.ensure('getMovements');
    return this.request<ExternalMovement[]>(`/movements${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  }
  async getInventory(location?: string) {
    await this.ensure('getInventory');
    return this.request<ExternalInventoryLine[]>(`/inventory${location ? `?location=${encodeURIComponent(location)}` : ''}`);
  }
  async createStockAdjustment(req: StockAdjustmentRequest): Promise<WriteResult> {
    await this.ensure('createStockAdjustment');
    return this.request('/stock-adjustments', { method: 'POST', body: JSON.stringify(req), headers: { 'Idempotency-Key': req.idempotencyKey } });
  }
  async updateInventory(req: InventoryUpdateRequest): Promise<WriteResult> {
    await this.ensure('updateInventory');
    return this.request('/inventory', { method: 'POST', body: JSON.stringify(req), headers: { 'Idempotency-Key': req.idempotencyKey } });
  }
  async createOrder(req: OrderRequest): Promise<WriteResult> {
    await this.ensure('createOrder');
    return this.request('/orders', { method: 'POST', body: JSON.stringify(req), headers: { 'Idempotency-Key': req.idempotencyKey } });
  }
}

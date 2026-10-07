import { db } from '../../database/db';
import type { Integration, Product, SyncJob, SyncOperation } from '../../models';
import { applyMovement } from '../../services/stockService';
import { nowIso, uuid } from '../../utils/id';
import { friendlyError, isOnline } from './errors';
import { upsertReferences } from './linking';
import {
  IntegrationError, type Capability, type IntegrationAdapter, type InventoryUpdateRequest, type OrderRequest, type StockAdjustmentRequest,
} from './types';

export type StepKey = 'products' | 'categories' | 'units' | 'locations' | 'stock' | 'movements';
export interface StepResult {
  key: StepKey;
  label: string;
  status: 'ok' | 'error' | 'not_supported' | 'skipped';
  count?: number;
  message?: string;
}

const STEPS: { key: StepKey; label: string; capability: Capability }[] = [
  { key: 'products', label: 'Productos', capability: 'getProducts' },
  { key: 'categories', label: 'Categorías', capability: 'getCategories' },
  { key: 'units', label: 'Unidades', capability: 'getUnits' },
  { key: 'locations', label: 'Depósitos', capability: 'getLocations' },
  { key: 'stock', label: 'Stock', capability: 'getStock' },
  { key: 'movements', label: 'Movimientos', capability: 'getMovements' },
];

const linkedIndex = (products: Product[]) =>
  new Map(products.filter((p) => p.externalSystems?.maxirest).map((p) => [p.externalSystems!.maxirest!.id, p]));

/**
 * Sincronización "pull": trae datos del sistema externo. Cada paso es independiente:
 * un error en uno no impide los demás. Según la fuente principal de stock:
 *  - maxirest:     el stock local de productos vinculados se alinea al de Maxirest.
 *  - stockmanager: los movimientos externos se aplican localmente (idempotentes).
 *  - manual:       sólo se guarda la copia para conciliación; nada se aplica solo.
 */
export async function runSync(adapter: IntegrationAdapter, integration: Integration): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const caps = await adapter.capabilities();
  const runId = uuid();
  const source = adapter.kind === 'mock' ? 'mock' : 'api';

  for (const step of STEPS) {
    if (caps[step.capability] !== 'supported') {
      results.push({ key: step.key, label: step.label, status: 'not_supported', message: 'No disponible en esta integración.' });
      continue;
    }
    try {
      let count = 0;
      switch (step.key) {
        case 'products': {
          const rows = await adapter.getProducts();
          count = await upsertReferences('maxirest', 'product', rows.map((r) => ({ externalId: r.externalId, code: r.code, name: r.name, unitName: r.unitName, categoryName: r.categoryName, locationName: r.locationName, source })));
          break;
        }
        case 'categories':
        case 'units':
        case 'locations': {
          const type = ({ categories: 'category', units: 'unit', locations: 'location' } as const)[step.key];
          const rows = await (step.key === 'categories' ? adapter.getCategories() : step.key === 'units' ? adapter.getUnits() : adapter.getLocations());
          count = await upsertReferences('maxirest', type, rows.map((r) => ({ externalId: r.externalId, code: r.code, name: r.name, source })));
          break;
        }
        case 'stock': {
          const stock = await adapter.getStock();
          const totals = new Map<string, number>();
          for (const s of stock) totals.set(s.productExternalId, (totals.get(s.productExternalId) ?? 0) + s.quantity);
          const refs = await db.externalReferences.where({ system: 'maxirest', entityType: 'product' }).toArray();
          await db.externalReferences.bulkPut(refs.map((r) => (totals.has(r.externalId) ? { ...r, stock: totals.get(r.externalId), updatedAt: nowIso() } : r)));
          count = totals.size;
          if (integration.stockAuthority === 'maxirest') {
            const linked = linkedIndex(await db.products.toArray());
            for (const [extId, qty] of totals) {
              const p = linked.get(extId);
              if (!p || p.stock === qty) continue;
              await applyMovement({ productId: p.id, type: 'ajuste', newQuantity: qty, reason: 'Alineado con Maxirest', origin: 'sincronizacion', sourceSystem: 'maxirest', idempotencyKey: `sync:${runId}:${extId}`, syncId: runId });
            }
          }
          break;
        }
        case 'movements': {
          const movs = await adapter.getMovements(integration.lastSyncAt);
          count = movs.length;
          if (integration.stockAuthority === 'stockmanager') {
            const linked = linkedIndex(await db.products.toArray());
            for (const m of movs) {
              const p = linked.get(m.productExternalId);
              if (!p) continue;
              await applyMovement({ productId: p.id, type: m.delta < 0 ? 'consumo' : 'ingreso', delta: m.delta, reason: m.concept ?? 'Movimiento Maxirest', origin: 'sincronizacion', sourceSystem: 'maxirest', externalMovementId: m.externalId, idempotencyKey: `ext:maxirest:mov:${m.externalId}`, syncId: runId });
            }
          }
          break;
        }
      }
      results.push({ key: step.key, label: step.label, status: 'ok', count });
    } catch (err) {
      const notSup = err instanceof IntegrationError && err.code === 'NOT_SUPPORTED';
      results.push({ key: step.key, label: step.label, status: notSup ? 'not_supported' : 'error', message: friendlyError(err, `leer ${step.label.toLowerCase()}`).message });
    }
  }
  const failed = results.some((r) => r.status === 'error');
  await db.integrations.update(integration.id, {
    lastSyncAt: failed ? integration.lastSyncAt : nowIso(),
    status: failed ? 'error' : 'conectado',
    lastError: failed ? results.find((r) => r.status === 'error')?.message : undefined,
    updatedAt: nowIso(),
  });
  return results;
}

// ─────────────────────────── Cola de sincronización ───────────────────────────

/** Agrega un trabajo a la cola. Si la clave ya existe no se duplica. */
export async function enqueue(operation: SyncOperation, payload: Record<string, unknown>, idempotencyKey: string): Promise<SyncJob> {
  const existing = await db.syncJobs.where('idempotencyKey').equals(idempotencyKey).first();
  if (existing) return existing;
  const t = nowIso();
  const job: SyncJob = { id: uuid(), createdAt: t, updatedAt: t, system: 'maxirest', operation, payload, idempotencyKey, status: 'pendiente', attempts: 0 };
  await db.syncJobs.add(job);
  return job;
}

const ACTION: Record<SyncOperation, string> = {
  createStockAdjustment: 'actualizar el stock en Maxirest',
  updateInventory: 'enviar el inventario a Maxirest',
  createOrder: 'enviar el pedido a Maxirest',
};

export async function processJob(adapter: IntegrationAdapter, job: SyncJob): Promise<SyncJob> {
  if (job.status === 'sincronizado') return job;
  const t = nowIso();
  try {
    if (!isOnline()) throw new IntegrationError('OFFLINE');
    const payload = { ...job.payload, idempotencyKey: job.idempotencyKey } as unknown;
    if (job.operation === 'createStockAdjustment') await adapter.createStockAdjustment(payload as StockAdjustmentRequest);
    else if (job.operation === 'updateInventory') await adapter.updateInventory(payload as InventoryUpdateRequest);
    else await adapter.createOrder(payload as OrderRequest);
    const done: SyncJob = { ...job, status: 'sincronizado', attempts: job.attempts + 1, error: undefined, technicalError: undefined, updatedAt: t };
    await db.syncJobs.put(done);
    return done;
  } catch (err) {
    const { message, technical } = friendlyError(err, ACTION[job.operation]);
    const failed: SyncJob = { ...job, status: 'error', attempts: job.attempts + 1, error: message, technicalError: technical, updatedAt: t };
    await db.syncJobs.put(failed);
    return failed;
  }
}

/** Procesa todos los trabajos pendientes o con error. */
export async function processQueue(adapter: IntegrationAdapter): Promise<{ ok: number; failed: number }> {
  const jobs = await db.syncJobs.where('status').anyOf('pendiente', 'error').sortBy('createdAt');
  let ok = 0;
  let failed = 0;
  for (const job of jobs) {
    if ((await processJob(adapter, job)).status === 'sincronizado') ok++;
    else failed++;
  }
  return { ok, failed };
}

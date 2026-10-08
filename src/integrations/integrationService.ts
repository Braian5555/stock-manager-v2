import { db } from '../database/db';
import type { Integration, IntegrationMode, StockAuthority, SyncInterval } from '../models';
import { applyMovement } from '../services/stockService';
import { defaultIntegration } from '../services/seedService';
import { nowIso } from '../utils/id';
import { friendlyError } from './core/errors';
import { enqueue, processJob, processQueue, runSync, type StepResult } from './core/syncEngine';
import type { CapabilityMap, ConnectionResult } from './core/types';
import { getAdapter } from './registry';

export const INTEGRATION_STATUS_LABEL: Record<Integration['status'], string> = {
  no_configurado: 'No configurado',
  configurado: 'Configurado',
  conectado: 'Conectado',
  error: 'Error',
  desconectado: 'Desconectado',
};

export const MODE_LABEL: Record<IntegrationMode, string> = {
  disabled: 'Modo independiente',
  mock: 'Demostración (Maxirest simulado)',
  gateway: 'Maxirest vía gateway',
  excel: 'Excel Bridge (manual)',
};

export async function getIntegration(): Promise<Integration> {
  return (await db.integrations.get('maxirest')) ?? defaultIntegration();
}

async function patch(p: Partial<Integration>) {
  const current = await getIntegration();
  await db.integrations.put({ ...current, ...p, updatedAt: nowIso() });
}

export async function configureIntegration(opts: { mode: IntegrationMode; gatewayUrl?: string; stockAuthority?: StockAuthority; syncInterval?: SyncInterval }) {
  const url = opts.gatewayUrl?.trim() || undefined;
  if (opts.mode === 'gateway') {
    if (!url) throw new Error('Ingresá la URL del gateway.');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('La URL del gateway no es válida.');
    }
    if (parsed.username || parsed.password || parsed.search) throw new Error('La URL no debe contener usuario, contraseña ni parámetros (nunca pongas credenciales en la URL).');
  }
  await patch({
    mode: opts.mode,
    gatewayUrl: opts.mode === 'gateway' ? url : undefined,
    stockAuthority: opts.stockAuthority ?? (await getIntegration()).stockAuthority,
    syncInterval: opts.syncInterval ?? (await getIntegration()).syncInterval,
    status: opts.mode === 'disabled' ? 'no_configurado' : 'configurado',
    lastError: undefined,
  });
}

export async function updateIntegrationOptions(p: Partial<Pick<Integration, 'stockAuthority' | 'syncInterval'>>) {
  await patch(p);
}

export async function testConnection(): Promise<ConnectionResult> {
  const integ = await getIntegration();
  const adapter = getAdapter({ ...integ, status: 'configurado' });
  if (!adapter) return { ok: false, message: 'No hay una conexión configurada.' };
  try {
    const r = await adapter.testConnection();
    await patch({ status: r.ok ? 'conectado' : 'error', lastError: r.ok ? undefined : r.message });
    return r;
  } catch (e) {
    const { message } = friendlyError(e, 'conectar');
    await patch({ status: 'error', lastError: message });
    return { ok: false, message };
  }
}

export async function getCapabilities(): Promise<CapabilityMap | null> {
  const adapter = getAdapter(await getIntegration());
  if (!adapter) return null;
  try {
    return await adapter.capabilities();
  } catch {
    return null;
  }
}

export async function syncNow(): Promise<StepResult[]> {
  const integ = await getIntegration();
  const adapter = getAdapter(integ);
  if (!adapter) throw new Error('La integración no está conectada.');
  const results = await runSync(adapter, integ);
  await processQueue(adapter);
  return results;
}

/** Detiene la sincronización. NO borra productos, vínculos, pedidos ni movimientos. */
export async function disconnectIntegration() {
  await patch({ status: 'desconectado' });
}

export async function reconnectIntegration() {
  const integ = await getIntegration();
  await patch({ status: integ.mode === 'disabled' ? 'no_configurado' : 'configurado' });
}

export async function canSyncAdjustments(): Promise<boolean> {
  const caps = await getCapabilities();
  return caps?.createStockAdjustment === 'supported';
}

/**
 * Ajuste SINCRONIZADO: registra el ajuste local y lo encola para el sistema externo.
 * Si no hay conexión o falla, queda en la cola como pendiente/error y se puede reintentar.
 */
export async function syncedAdjustment(productId: string, newQuantity: number, reason: string, idempotencyKey?: string) {
  const product = await db.products.get(productId);
  const link = product?.externalSystems?.maxirest;
  if (!product || !link) throw new Error('El producto no está vinculado con Maxirest.');
  const ref = await db.externalReferences.where({ system: 'maxirest', entityType: 'product', externalId: link.id }).first();
  const { movement } = await applyMovement({
    productId, type: 'ajuste', newQuantity, reason, origin: 'manual', idempotencyKey,
  });
  const job = await enqueue(
    'createStockAdjustment',
    { productExternalId: link.id, newQuantity, delta: newQuantity - (ref?.stock ?? movement.quantityBefore), reason, localMovementId: movement.id },
    `adj:${movement.id}`,
  );
  await db.movements.update(movement.id, { syncId: job.id, updatedAt: nowIso() });
  const adapter = getAdapter(await getIntegration());
  const result = adapter ? await processJob(adapter, job) : job;
  if (result.status === 'sincronizado' && ref) await db.externalReferences.update(ref.id, { stock: newQuantity, updatedAt: nowIso() });
  return { movement, job: result };
}

export async function retryJob(jobId: string) {
  const job = await db.syncJobs.get(jobId);
  const adapter = getAdapter(await getIntegration());
  if (!job || !adapter) throw new Error('La integración no está conectada.');
  const result = await processJob(adapter, job);
  if (result.status === 'sincronizado' && result.operation === 'createStockAdjustment') {
    const extId = String(result.payload.productExternalId);
    const ref = await db.externalReferences.where({ system: 'maxirest', entityType: 'product', externalId: extId }).first();
    if (ref) await db.externalReferences.update(ref.id, { stock: Number(result.payload.newQuantity), updatedAt: nowIso() });
  }
  return result;
}

export async function syncPending() {
  const adapter = getAdapter(await getIntegration());
  if (!adapter) throw new Error('La integración no está conectada.');
  const jobs = await db.syncJobs.where('status').anyOf('pendiente', 'error').toArray();
  let ok = 0;
  for (const j of jobs) if ((await retryJob(j.id)).status === 'sincronizado') ok++;
  return { ok, failed: jobs.length - ok };
}

/**
 * Envía a Maxirest las diferencias de un conteo (sólo productos vinculados y con diferencia).
 * Cada línea es un trabajo idempotente: reenviar el mismo conteo no duplica ajustes.
 */
export async function sendCountToExternal(countId: string) {
  const integ = await getIntegration();
  const adapter = getAdapter(integ);
  if (!adapter) throw new Error('La integración no está conectada.');
  const caps = await adapter.capabilities();
  if (caps.createStockAdjustment !== 'supported') throw new Error('La integración actual no permite enviar ajustes a Maxirest.');
  const count = await db.counts.get(countId);
  if (count?.outletId) throw new Error('Los conteos de un punto no se envían a Maxirest como ajuste del producto.');
  const items = await db.countItems.where('countId').equals(countId).toArray();
  const refs = new Map((await db.externalReferences.where({ system: 'maxirest', entityType: 'product' }).toArray()).map((r) => [r.externalId, r]));
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    if (item.counted === undefined) continue;
    const product = await db.products.get(item.productId);
    const extId = product?.externalSystems?.maxirest?.id;
    if (!extId) continue;
    const ref = refs.get(extId);
    if (ref?.stock === item.counted) continue;
    const job = await enqueue(
      'createStockAdjustment',
      { productExternalId: extId, newQuantity: item.counted, delta: item.counted - (ref?.stock ?? item.expected), reason: count?.name ?? 'Conteo' },
      `count:${countId}:${extId}`,
    );
    const r = await processJob(adapter, job);
    if (r.status === 'sincronizado') {
      ok++;
      if (ref) await db.externalReferences.update(ref.id, { stock: item.counted, updatedAt: nowIso() });
    } else failed++;
  }
  return { ok, failed };
}

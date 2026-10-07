import { describe, expect, it, vi } from 'vitest';
import { db } from '../../src/database/db';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { ensureBaseData } from '../../src/services/seedService';
import { MockMaxirestAdapter } from '../../src/integrations/mock/MockMaxirestAdapter';
import { MaxirestGatewayAdapter } from '../../src/integrations/maxirest/MaxirestGatewayAdapter';
import { runSync, enqueue, processQueue } from '../../src/integrations/core/syncEngine';
import { link, suggestMatch, createProductFromExternal } from '../../src/integrations/core/linking';
import { buildReconciliation } from '../../src/integrations/core/reconciliation';
import { IntegrationError } from '../../src/integrations/core/types';
import { detectMapping, toBridgeRows, importBridgeRows } from '../../src/integrations/maxirest/excelBridge';
import { parseCsv } from '../../src/importers/tabular';
import { MAXIREST_OFFICIAL } from '../../src/integrations/maxirest/officialStatus';
import { startCount } from '../../src/services/countService';
import { getIntegration } from '../../src/integrations/integrationService';

const mock = () => {
  const m = new MockMaxirestAdapter({ latencyMs: 0 });
  m.reset();
  return m;
};

describe('Maxirest real (gateway)', () => {
  it('sin gateway todas las operaciones son NOT_SUPPORTED / NOT_CONFIGURED', async () => {
    const a = new MaxirestGatewayAdapter(undefined);
    const caps = await a.capabilities();
    expect(Object.values(caps).every((v) => v === 'not_supported')).toBe(true);
    await expect(a.getStock()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    expect((await a.testConnection()).ok).toBe(false);
  });

  it('sólo usa lo que el gateway declara, y nunca manda credenciales', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ capabilities: { getStock: 'supported', createOrder: 'pending_enablement' } }));
      if (url.endsWith('/stock')) return new Response(JSON.stringify([{ productExternalId: 'A', quantity: 3 }]));
      expect(init?.headers).not.toHaveProperty('Authorization');
      return new Response('{}', { status: 500 });
    });
    const a = new MaxirestGatewayAdapter('https://gw.example', fetchImpl as unknown as typeof fetch);
    expect(await a.getStock()).toEqual([{ productExternalId: 'A', quantity: 3 }]);
    await expect(a.createOrder({ idempotencyKey: 'k', lines: [] })).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    await expect(a.getProducts()).rejects.toBeInstanceOf(IntegrationError);
    expect(fetchImpl.mock.calls.every(([u]) => String(u).startsWith('https://gw.example/v1/maxirest/'))).toBe(true);
  });

  it('rechaza gateways sin HTTPS', async () => {
    const a = new MaxirestGatewayAdapter('http://gw.example');
    await expect(a.testConnection()).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('el estado oficial documentado no marca nada como soportado', () => {
    expect(Object.values(MAXIREST_OFFICIAL).some((v) => (v.status as string) === 'supported')).toBe(false);
  });
});

describe('Mock Maxirest + sincronización', () => {
  it('sincroniza, vincula sin duplicar, concilia y alinea según la fuente principal', async () => {
    await ensureBaseData();
    const papa = await saveProduct({ ...emptyProduct(), name: 'Papa', sku: 'VER-001' }, 10);
    const integ = { ...(await getIntegration()), mode: 'mock' as const, status: 'conectado' as const, stockAuthority: 'manual' as const };
    await db.integrations.put(integ);
    const adapter = mock();
    const res = await runSync(adapter, integ);
    expect(res.find((r) => r.key === 'products')).toMatchObject({ status: 'ok', count: 12 });
    expect(res.find((r) => r.key === 'stock')!.status).toBe('ok');

    const refs = await db.externalReferences.where({ system: 'maxirest', entityType: 'product' }).toArray();
    const ref = refs.find((r) => r.code === 'VER-001')!;
    expect(suggestMatch(ref, await db.products.toArray())?.id).toBe(papa.id);
    await link('product', papa.id, ref);
    // vincular otro producto al mismo insumo desvincula el anterior (sin duplicados)
    const otro = await saveProduct({ ...emptyProduct(), name: 'Otra papa' });
    await link('product', otro.id, ref);
    expect((await db.products.get(papa.id))!.externalSystems?.maxirest).toBeUndefined();
    await link('product', papa.id, ref);
    await expect(createProductFromExternal(ref)).rejects.toThrow();

    const rows = buildReconciliation(await db.products.toArray(), refs.map((r) => (r.id === ref.id ? { ...r, stock: 3 } : r)));
    const row = rows.find((r) => r.product?.id === papa.id)!;
    expect(row).toMatchObject({ local: 10, external: 3, difference: 7, state: 'positiva' });
    expect(rows.filter((r) => r.state === 'no_vinculado')).toHaveLength(11);
    expect((await db.products.get(papa.id))!.stock).toBe(10); // modo manual: no se aplica solo

    await runSync(adapter, { ...integ, stockAuthority: 'maxirest' });
    expect((await db.products.get(papa.id))!.stock).toBe(3);

    const count = await startCount({ baseline: 'maxirest' });
    const item = await db.countItems.where({ countId: count.id, productId: papa.id }).first();
    expect(item!.expected).toBe(3);
  });

  it('cola: errores quedan pendientes con mensaje comprensible y se reintentan sin duplicar', async () => {
    const adapter = mock();
    adapter.setSimulatedFailure(true);
    await enqueue('createStockAdjustment', { productExternalId: 'I1007', newQuantity: 17, delta: -3 }, 'adj:1');
    await enqueue('createStockAdjustment', { productExternalId: 'I1007', newQuantity: 17, delta: -3 }, 'adj:1');
    expect(await db.syncJobs.count()).toBe(1);
    expect(await processQueue(adapter)).toEqual({ ok: 0, failed: 1 });
    const failed = (await db.syncJobs.toArray())[0];
    expect(failed.status).toBe('error');
    expect(failed.error).toMatch(/No fue posible actualizar el stock en Maxirest/);
    expect(failed.error).not.toMatch(/503|500/);
    adapter.setSimulatedFailure(false);
    expect(await processQueue(adapter)).toEqual({ ok: 1, failed: 0 });
    expect(await processQueue(adapter)).toEqual({ ok: 0, failed: 0 });
    expect((await adapter.getStock()).find((s) => s.productExternalId === 'I1007')!.quantity).toBe(17);
  });

  it('el mock declara createOrder como NO soportado', async () => {
    const a = mock();
    expect((await a.capabilities()).createOrder).toBe('not_supported');
    await expect(a.createOrder({ idempotencyKey: 'x', lines: [] })).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });
});

describe('Excel Bridge', () => {
  it('detecta columnas de un inventario exportado e importa la copia externa', async () => {
    const tab = parseCsv('Inventario depósito 1;;\nCódigo;Nombre;Unidad de medida;Costo;Stock actual;Conteo\n101;Papa;Kg;10,5;20;17\n102;Tomate;Kg;5;"8,5";\n;;;;;\n');
    const mapping = detectMapping(tab.headers);
    expect(mapping).toMatchObject({ code: 0, name: 1, unit: 2, stock: 4, counted: 5 });
    const { rows } = toBridgeRows(tab, mapping);
    expect(rows).toEqual([
      expect.objectContaining({ externalId: '101', name: 'Papa', stock: 20, counted: 17 }),
      expect.objectContaining({ externalId: '102', name: 'Tomate', stock: 8.5, counted: undefined }),
    ]);
    expect(await importBridgeRows(rows)).toBe(2);
    expect(await importBridgeRows(rows)).toBe(2);
    expect(await db.externalReferences.count()).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { MaxirestGatewayAdapter } from '../../src/integrations/maxirest/MaxirestGatewayAdapter';
// @ts-expect-error módulo JS de referencia sin tipos
import { handle } from '../../server/gateway-reference/handler.mjs';

describe('contrato PWA ⇄ gateway de referencia', () => {
  const fetchImpl = ((input: string, init?: RequestInit) => handle(new Request(input, init), {})) as unknown as typeof fetch;
  const adapter = new MaxirestGatewayAdapter('https://gw.example', fetchImpl);

  it('conecta, pero no declara ninguna operación como soportada', async () => {
    const r = await adapter.testConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toContain('0 de 10');
    const caps = await adapter.capabilities();
    expect(Object.values(caps).every((v) => v === 'pending_enablement')).toBe(true);
  });

  it('las operaciones devuelven NOT_SUPPORTED (no se simula soporte)', async () => {
    await expect(adapter.getStock()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    await expect(adapter.createStockAdjustment({ idempotencyKey: 'k', productExternalId: 'x', newQuantity: 1, delta: 1 })).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });

  it('el gateway exige Idempotency-Key en escrituras', async () => {
    const res = await handle(new Request('https://gw.example/v1/maxirest/stock-adjustments', { method: 'POST', body: '{}' }), {});
    expect(res.status).toBe(400);
  });
});

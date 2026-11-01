import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/cloud/cloudService', () => ({ cloudSession: async () => ({ token: 't', wsId: 'w' }) }));
vi.mock('../../src/services/invoiceAI', () => ({ workerProvider: async () => 'gemini', workerModel: () => 'gemini-3.8-flash' }));

describe('asistente: envío a Gemini', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('limita el razonamiento y, si el modelo no lo acepta, reintenta sin ese límite', async () => {
    const { workerTransport, buildAssistantRequest, thinkingFor } = await import('../../src/services/assistant/engine');
    expect(thinkingFor('gemini-3.8-flash')).toEqual({ thinkingLevel: 'low' });
    expect(thinkingFor('gemini-2.5-flash')).toEqual({ thinkingBudget: 1024 });
    const body = buildAssistantRequest('sistema', [{ role: 'user', parts: [{ text: 'hola' }] }], []);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 8192 });
    const sent: Record<string, unknown>[] = [];
    let rejectBudget = false;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      sent.push(b);
      if (b.generationConfig.thinkingConfig?.thinkingLevel || (b.generationConfig.thinkingConfig && rejectBudget)) return new Response(JSON.stringify({ error: { code: 400, message: 'Unknown name "thinkingConfig" at generation_config' } }), { status: 400 });
      return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    }));
    const send = workerTransport('https://ia.example.workers.dev/');
    expect(await send(body)).toEqual({ candidates: [] });
    // 1) thinkingLevel rechazado → 2) thinkingBudget aceptado.
    expect(sent.map((b) => (b.generationConfig as { thinkingConfig?: unknown }).thinkingConfig)).toEqual([{ thinkingLevel: 'low' }, { thinkingBudget: 1024 }]);
    // 3) Si después rechaza también el budget, va sin límite y queda así.
    rejectBudget = true;
    await send(body);
    await send(body);
    expect(sent.slice(2).map((b) => (b.generationConfig as { thinkingConfig?: unknown }).thinkingConfig)).toEqual([{ thinkingBudget: 1024 }, undefined, undefined]);
    expect(sent).toHaveLength(5);
  });
});

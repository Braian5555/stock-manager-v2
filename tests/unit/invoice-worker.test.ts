import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../../workers/invoice-reader/worker.js';
import { buildRequest } from '../../functions/reader.mjs';

const { handle } = worker._test;
const ORIGIN = 'https://stock-manager-a7cf7.web.app';
const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let keys: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string };
async function token(claims: Record<string, unknown> = {}, kid = 'k1', signer?: CryptoKey) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify({ aud: 'stock-manager-a7cf7', iss: 'https://securetoken.google.com/stock-manager-a7cf7', sub: 'uid-braian', iat: now, exp: now + 3600, ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer ?? keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

/** Google (claves públicas), Firestore (espacio) y Anthropic simulados. */
function fakeNet(opts: { members?: string[]; anthropic?: (body: string, headers: Headers) => Response } = {}) {
  const calls: string[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'max-age=3600' } });
    if (url.includes('firestore.googleapis.com')) {
      const members = opts.members ?? ['uid-braian'];
      return new Response(JSON.stringify({ fields: { memberUids: { arrayValue: { values: members.map((m) => ({ stringValue: m })) } } } }));
    }
    if (url === 'https://api.anthropic.com/v1/messages') return opts.anthropic ? opts.anthropic(String(init?.body), new Headers(init?.headers)) : new Response('{"content":[]}');
    return new Response('not found', { status: 404 });
  };
  return { f, calls };
}

const body = () => JSON.stringify(buildRequest([{ type: 'image/jpeg', data: 'AAAA' }], [{ ref: '1', name: 'Coca', unit: 'u', buy: '' }]));
const req = async (opts: { auth?: string; ws?: string; origin?: string; body?: string; method?: string } = {}) =>
  new Request('https://worker.example/', {
    method: opts.method ?? 'POST',
    headers: { Origin: opts.origin ?? ORIGIN, Authorization: `Bearer ${opts.auth ?? (await token())}`, 'X-Workspace': opts.ws ?? 'ws_123', 'Content-Type': 'application/json' },
    body: (opts.method ?? 'POST') === 'POST' ? (opts.body ?? body()) : undefined,
  });
const env = { ANTHROPIC_API_KEY: 'sk-ant-secreta' };

describe('servidor de Cloudflare para leer facturas', () => {
  beforeAll(async () => {
    keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };
  });

  it('miembro con sesión válida: reenvía a Claude con la clave (que nunca vuelve a la app)', async () => {
    let seen: Headers | undefined;
    const net = fakeNet({ anthropic: (_b, h) => { seen = h; return new Response('{"content":[{"type":"text","text":"{}"}]}'); } });
    const r = await handle(await req(), env, net.f);
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(seen?.get('x-api-key')).toBe('sk-ant-secreta');
    expect(seen?.get('anthropic-version')).toBe('2023-06-01');
    expect(await r.text()).not.toContain('sk-ant');
  });

  it('rechaza sesiones falsas, vencidas o de otro proyecto', async () => {
    const other = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const net = fakeNet();
    for (const auth of [
      'basura',
      await token({}, 'k1', other.privateKey), // firmado por otra clave
      await token({ exp: Math.floor(Date.now() / 1000) - 10 }), // vencido
      await token({ aud: 'otro-proyecto', iss: 'https://securetoken.google.com/otro-proyecto' }),
      await token({}, 'k-desconocida'),
    ]) {
      const r = await handle(await req({ auth }), env, net.f);
      expect(r.status).toBe(401);
    }
    expect(net.calls).not.toContain('https://api.anthropic.com/v1/messages');
  });

  it('rechaza a quien no es miembro, otros orígenes, otros modelos y pedidos enormes', async () => {
    expect((await handle(await req(), env, fakeNet({ members: ['otro'] }).f)).status).toBe(403);
    expect((await handle(await req({ ws: '../x' }), env, fakeNet().f)).status).toBe(403);
    expect((await handle(await req({ origin: 'https://malicioso.example' }), env, fakeNet().f)).status).toBe(403);
    expect((await handle(await req({ body: body().replace('claude-sonnet-5-5', 'claude-opus-5-5') }), env, fakeNet().f)).status).toBe(400);
    expect((await handle(await req({ body: `{"model":"claude-sonnet-5-5","x":"${'A'.repeat(9_100_000)}"}` }), env, fakeNet().f)).status).toBe(413);
  });

  it('sin clave cargada avisa; la prueba de conexión dice si está configurado', async () => {
    const r = await handle(await req(), {}, fakeNet().f);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain('ANTHROPIC_API_KEY');
    const g = await handle(await req({ method: 'GET' }), env, fakeNet().f);
    expect(await g.json()).toMatchObject({ ok: true, configured: true, model: 'claude-sonnet-5-5' });
    const o = await handle(new Request('https://worker.example/', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env, fakeNet().f);
    expect(o.status).toBe(204);
    expect(o.headers.get('Access-Control-Allow-Headers')).toContain('X-Workspace');
  });
});

describe('servidor de Cloudflare: Gemini (gratis)', () => {
  const genv = { GEMINI_API_KEY: 'AIza-secreta' };
  const gbody = async () => JSON.stringify((await import('../../functions/reader.mjs')).buildGeminiRequest([{ type: 'image/jpeg', data: 'AAAA' }], [{ ref: '1', name: 'Coca', unit: 'u', buy: '' }]));
  const greq = async (opts: { body?: string; lite?: boolean } = {}) =>
    new Request(`https://worker.example/gemini${opts.lite ? '?lite=1' : ''}`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Authorization: `Bearer ${await token()}`, 'X-Workspace': 'ws_123', 'Content-Type': 'application/json' },
      body: opts.body ?? (await gbody()),
    });
  function geminiNet(statusByModel: Record<string, number>) {
    const calls: { url: string; key: string | null }[] = [];
    const base = fakeNet();
    const f = async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        calls.push({ url, key: new Headers(init?.headers).get('x-goog-api-key') });
        const model = /models\/([^:]+):/.exec(url)![1];
        const status = statusByModel[model] ?? 200;
        return new Response(status === 200 ? '{"candidates":[{"content":{"parts":[{"text":"{}"}]},"finishReason":"STOP"}]}' : '{"error":{"status":"NOT_FOUND"}}', { status });
      }
      return base.f(url, init);
    };
    return { f, calls };
  }

  it('reenvía a Google con la clave en el encabezado y avisa qué IA tiene', async () => {
    const net = geminiNet({});
    const r = await handle(await greq(), genv, net.f);
    expect(r.status).toBe(200);
    expect(net.calls).toEqual([{ url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', key: 'AIza-secreta' }]);
    expect(await r.text()).not.toContain('AIza');
    const g = await handle(new Request('https://worker.example/', { headers: { Origin: ORIGIN } }), genv, net.f);
    expect(await g.json()).toMatchObject({ configured: true, provider: 'gemini', model: 'gemini-3.8-flash' });
  });

  it('con ?lite=1 (la app reintenta porque el principal tardó) arranca por el modelo liviano', async () => {
    const net = geminiNet({});
    const r = await handle(await greq({ lite: true }), genv, net.f);
    expect(r.status).toBe(200);
    expect(net.calls.map((c) => c.url)).toEqual(['https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent']);
  });

  it('si un modelo no existe o no está en el plan gratis, prueba el siguiente', async () => {
    const net = geminiNet({ 'gemini-3.8-flash': 404, 'gemini-3.6-flash': 429 });
    const r = await handle(await greq(), genv, net.f);
    expect(r.status).toBe(200);
    expect(net.calls.map((c) => /models\/([^:]+):/.exec(c.url)![1])).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']);
    // Si fallan todos, se devuelve el error que explica (límite del día) y no el "no existe" del último.
    const none = geminiNet({ 'gemini-3.8-flash': 429, 'gemini-3.6-flash': 429, 'gemini-3.5-flash-lite': 429, 'gemini-3.1-flash-lite': 404 });
    expect((await handle(await greq(), genv, none.f)).status).toBe(429);
    // Un modelo saturado (503) también pasa al siguiente.
    const busy = geminiNet({ 'gemini-3.8-flash': 503 });
    expect((await handle(await greq(), genv, busy.f)).status).toBe(200);
    expect(busy.calls.map((c) => /models\/([^:]+):/.exec(c.url)![1])).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash']);
    // Con GEMINI_MODEL, ése va primero; si no existe, se sigue con los de siempre.
    const net2 = geminiNet({ 'gemini-x': 404 });
    expect((await handle(await greq(), { ...genv, GEMINI_MODEL: 'gemini-x' }, net2.f)).status).toBe(200);
    expect(net2.calls.map((c) => /models\/([^:]+):/.exec(c.url)![1])).toEqual(['gemini-x', 'gemini-3.8-flash']);
  });

  it('rechaza pedidos que no son de lectura, sesiones falsas y servidor sin clave', async () => {
    expect((await handle(await greq({ body: '{"contents":[]}' }), genv, geminiNet({}).f)).status).toBe(400);
    const bad = new Request('https://worker.example/gemini', { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer basura', 'X-Workspace': 'ws_123' }, body: await gbody() });
    expect((await handle(bad, genv, geminiNet({}).f)).status).toBe(401);
    const none = await handle(await greq(), {}, geminiNet({}).f);
    expect(none.status).toBe(503);
    expect((await none.json()).error).toContain('GEMINI_API_KEY');
  });
});

describe('worker: gateway de Maxirest', () => {
  const mx = (path: string, init: { method?: string; auth?: string; ws?: string; idem?: string } = {}) =>
    new Request(`https://worker.example/v1/maxirest${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: ORIGIN, ...(init.auth ? { Authorization: `Bearer ${init.auth}` } : {}), ...(init.ws ? { 'X-Workspace': init.ws } : {}), ...(init.idem ? { 'Idempotency-Key': init.idem } : {}) },
      ...(init.method === 'POST' ? { body: '{}' } : {}),
    });

  it('informa salud y que todo está pendiente de habilitación (no inventa soporte)', async () => {
    const { f } = fakeNet();
    const health = await handle(mx('/health'), {}, f);
    expect(await health.json()).toEqual({ ok: true, maxirest: 'not_enabled' });
    const caps = await (await handle(mx('/capabilities'), {}, f)).json();
    expect(Object.values(caps.capabilities).every((v) => v === 'pending_enablement')).toBe(true);
    expect(Object.keys(caps.capabilities)).toHaveLength(10);
  });

  it('los datos del negocio piden sesión y ser miembro; después responde 501', async () => {
    const { f } = fakeNet({ members: ['uid-braian'] });
    expect((await handle(mx('/stock'), {}, f)).status).toBe(401);
    expect((await handle(mx('/stock', { auth: await token(), ws: 'ws_otro' }), {}, fakeNet({ members: ['otro'] }).f)).status).toBe(403);
    expect((await handle(mx('/stock', { auth: await token(), ws: 'ws_123' }), {}, f)).status).toBe(501);
    expect((await handle(mx('/stock-adjustments', { method: 'POST', auth: await token(), ws: 'ws_123' }), {}, f)).status).toBe(400);
    expect((await handle(mx('/stock-adjustments', { method: 'POST', auth: await token(), ws: 'ws_123', idem: 'k1' }), {}, f)).status).toBe(501);
  });

  it('la app manda la sesión de Firebase al gateway (sin cookies)', async () => {
    const { MaxirestGatewayAdapter } = await import('../../src/integrations/maxirest/MaxirestGatewayAdapter');
    const seen: RequestInit[] = [];
    const f = (async (url: string, init: RequestInit) => { seen.push(init); return handle(new Request(url, init), {}, fakeNet().f); }) as unknown as typeof fetch;
    const t = await token();
    const a = new MaxirestGatewayAdapter('https://worker.example', f, async () => ({ token: t, wsId: 'ws_123' }));
    expect((await a.testConnection()).ok).toBe(true);
    await expect(a.getStock()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    expect(seen.every((i) => i.credentials === 'omit' && new Headers(i.headers).get('Authorization') === `Bearer ${t}` && new Headers(i.headers).get('X-Workspace') === 'ws_123')).toBe(true);
  });
});

describe('conectar Maxirest en un paso', () => {
  it('usa el servidor de la IA, deja a Stock Manager como fuente principal y queda esperando a Maxirest', async () => {
    const { connectMaxirest, getIntegration, getCapabilities } = await import('../../src/integrations/integrationService');
    const net = fakeNet();
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => handle(new Request(url, init), {}, net.f)) as typeof fetch;
    try {
      await expect(connectMaxirest(undefined)).rejects.toThrow(/activá la IA/);
      const r = await connectMaxirest('https://ia.example.workers.dev/');
      expect(r.ok).toBe(true);
      const i = await getIntegration();
      expect(i).toMatchObject({ mode: 'gateway', status: 'conectado', gatewayUrl: 'https://ia.example.workers.dev', stockAuthority: 'stockmanager' });
      const caps = await getCapabilities();
      expect(Object.values(caps!).every((v) => v === 'pending_enablement')).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

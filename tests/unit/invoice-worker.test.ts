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
  const greq = async (opts: { body?: string } = {}) =>
    new Request('https://worker.example/gemini', {
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

  it('si un modelo no existe o no está en el plan gratis, prueba el siguiente', async () => {
    const net = geminiNet({ 'gemini-3.8-flash': 404, 'gemini-3.5-flash-lite': 429 });
    const r = await handle(await greq(), genv, net.f);
    expect(r.status).toBe(200);
    expect(net.calls.map((c) => /models\/([^:]+):/.exec(c.url)![1])).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']);
    // Con GEMINI_MODEL fijo, sólo ese.
    const net2 = geminiNet({});
    await handle(await greq(), { ...genv, GEMINI_MODEL: 'gemini-x' }, net2.f);
    expect(net2.calls.map((c) => /models\/([^:]+):/.exec(c.url)![1])).toEqual(['gemini-x']);
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

/**
 * Stock Manager · Lectura de facturas con IA (Cloudflare Worker, plan gratis).
 *
 * Recibe de la app el pedido ya armado para Claude (fotos + catálogo + instrucciones), verifica que
 * quien lo manda tenga sesión iniciada en Stock Manager y sea miembro del espacio de trabajo, le
 * agrega la clave de Anthropic (guardada como secreto en Cloudflare, nunca en la app) y lo reenvía.
 *
 * Instalación (una vez): Cloudflare → Workers & Pages → Create → Worker → pegar este archivo → Deploy.
 * Después: Settings → Variables and Secrets → Add → Secret, nombre ANTHROPIC_API_KEY, valor = la clave.
 *
 * Archivo único y sin dependencias a propósito, para poder pegarlo en el editor de Cloudflare.
 */

const PROJECT_ID = 'stock-manager-a7cf7';
const ALLOWED_ORIGINS = [
  'https://stock-manager-a7cf7.web.app',
  'https://stock-manager-a7cf7.firebaseapp.com',
  'http://localhost:4173',
  'http://localhost:5173',
];
/** Único modelo permitido (así nadie puede usar la clave para otra cosa más cara). */
const MODEL = 'claude-sonnet-5-5';
/** Tamaño máximo del pedido: 6 fotos comprimidas + catálogo. */
const MAX_BODY = 9_000_000;
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let jwksCache = { keys: null, until: 0 };

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Workspace',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function googleKeys(fetchImpl) {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const r = await fetchImpl(JWKS_URL);
  if (!r.ok) throw new Error('No se pudieron obtener las claves de Google.');
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get('Cache-Control') ?? '')?.[1] ?? 3600);
  const { keys } = await r.json();
  jwksCache = { keys, until: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return keys;
}

/** Verifica el token de sesión de Firebase (firma RS256 de Google, proyecto, vencimiento). Devuelve el uid. */
async function verifyIdToken(token, fetchImpl = fetch, now = Date.now()) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new Error('Sesión inválida.');
  const [h, p, s] = parts;
  const header = b64urlJson(h);
  const payload = b64urlJson(p);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Sesión inválida.');
  const jwk = (await googleKeys(fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Sesión inválida.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) throw new Error('Sesión inválida.');
  const t = Math.floor(now / 1000);
  if (payload.aud !== PROJECT_ID || payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new Error('Sesión de otro proyecto.');
  if (!payload.sub || payload.exp <= t || payload.iat > t + 300) throw new Error('La sesión venció. Volvé a abrir la app.');
  return payload.sub;
}

/** Lee el espacio de trabajo con la sesión del usuario (las reglas de Firestore deciden) y verifica que sea miembro. */
async function isMember(wsId, token, uid, fetchImpl = fetch) {
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(wsId ?? '')) return false;
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/workspaces/${wsId}`;
  const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const doc = await r.json();
  const members = doc?.fields?.memberUids?.arrayValue?.values ?? [];
  return members.some((v) => v.stringValue === uid);
}

async function handle(request, env, fetchImpl = fetch) {
  const origin = request.headers.get('Origin') ?? '';
  const h = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  // Prueba de conexión desde la app (Configuración → Integraciones).
  if (request.method === 'GET') return reply(200, { ok: true, service: 'stock-manager-invoice-reader', configured: !!env.ANTHROPIC_API_KEY, model: MODEL }, h);
  if (request.method !== 'POST') return reply(405, { error: 'Método no permitido.' }, h);
  if (!ALLOWED_ORIGINS.includes(origin)) return reply(403, { error: 'Origen no permitido.' }, h);
  if (!env.ANTHROPIC_API_KEY) return reply(503, { error: 'Falta cargar la clave de Anthropic (secreto ANTHROPIC_API_KEY) en Cloudflare.' }, h);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return reply(413, { error: 'Las fotos son demasiado grandes.' }, h);

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let uid;
  try {
    uid = await verifyIdToken(token, fetchImpl);
  } catch (e) {
    return reply(401, { error: e.message }, h);
  }
  if (!(await isMember(request.headers.get('X-Workspace'), token, uid, fetchImpl))) {
    return reply(403, { error: 'No sos miembro de este espacio de trabajo.' }, h);
  }

  // El pedido se reenvía tal cual (sin interpretarlo: el plan gratis tiene poco tiempo de CPU).
  const body = await request.text();
  if (body.length > MAX_BODY) return reply(413, { error: 'Las fotos son demasiado grandes.' }, h);
  if (!body.startsWith(`{"model":"${MODEL}"`)) return reply(400, { error: 'Pedido no permitido.' }, h);

  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body,
  });
  return new Response(r.body, { status: r.status, headers: { ...h, 'Content-Type': 'application/json; charset=utf-8' } });
}

// Sólo `default`: Cloudflare trata otros exports como puntos de entrada. `_test` lo usan las pruebas.
export default { fetch: (request, env) => handle(request, env), _test: { handle, verifyIdToken, isMember, MODEL } };

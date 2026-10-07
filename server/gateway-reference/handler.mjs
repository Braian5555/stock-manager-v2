/**
 * Integration Gateway de referencia — Stock Manager ⇄ Maxirest
 *
 * Handler estándar (Request → Response) que corre en Cloudflare Workers, Vercel
 * (Edge/Node), Deno, Bun o Node 18+ sin cambios. NO contiene ninguna llamada a
 * Maxirest: Maxirest no publica una API documentada. Es el lugar donde, si Maxirest
 * habilita un acceso oficial, se implementan las operaciones con las credenciales
 * guardadas como SECRETOS DE LA PLATAFORMA (nunca en el frontend ni en GitHub).
 *
 * Contrato que espera la PWA (src/integrations/maxirest/MaxirestGatewayAdapter.ts):
 *   GET  /v1/maxirest/health         → { ok: boolean, maxirest: string }
 *   GET  /v1/maxirest/capabilities   → { capabilities: { [op]: 'supported' | 'not_supported' | 'pending_enablement' } }
 *   GET  /v1/maxirest/products|categories|units|locations|stock|movements|inventory
 *   POST /v1/maxirest/stock-adjustments | inventory | orders   (header Idempotency-Key obligatorio)
 *   Operación no habilitada → HTTP 501.
 */

const OPERATIONS = ['getProducts', 'getCategories', 'getUnits', 'getLocations', 'getStock', 'getMovements', 'getInventory', 'createStockAdjustment', 'updateInventory', 'createOrder'];

/** Cambiar a 'supported' SOLO lo que esté implementado y verificado contra Maxirest real. */
const CAPABILITIES = Object.fromEntries(OPERATIONS.map((op) => [op, 'pending_enablement']));

function cors(env, req) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.GATEWAY_ALLOWED_ORIGIN ?? 'https://braian5555.github.io').split(',').map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export async function handle(req, env = {}) {
  const headers = cors(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (!path.startsWith('/v1/maxirest')) return json({ message: 'Not found' }, 404, headers);
  const route = path.slice('/v1/maxirest'.length);

  if (route === '/health') return json({ ok: true, maxirest: 'not_enabled' }, 200, headers);
  if (route === '/capabilities') return json({ capabilities: CAPABILITIES }, 200, headers);

  if (req.method === 'POST' && !req.headers.get('Idempotency-Key')) return json({ message: 'Falta Idempotency-Key' }, 400, headers);

  // Ninguna operación está implementada hasta que Maxirest habilite un mecanismo oficial.
  return json({ message: 'Operación no habilitada en Maxirest.' }, 501, headers);
}

// Cloudflare Workers / Deno / Bun
export default { fetch: (req, env) => handle(req, env) };

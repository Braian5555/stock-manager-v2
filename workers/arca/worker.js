/**
 * Stock Manager · Facturación electrónica ARCA (ex AFIP) — Cloudflare Worker, plan gratis.
 *
 * Es el único lugar que habla con ARCA y el único que tiene el certificado y la clave privada
 * (guardados como SECRETOS de Cloudflare: nunca llegan a la app ni al navegador).
 *
 *   WSAA  (autenticación): arma el TRA, lo firma en CMS (PKCS#7) con el certificado y obtiene Token y Sign.
 *         El Token dura 12 h y se guarda en Cloudflare KV (binding ARCA_TA) para no pedirlo de nuevo.
 *   WSFEv1 (factura electrónica): último comprobante, pedido de CAE, consulta y parámetros.
 *
 * Quién puede usarlo: sólo personas con sesión iniciada en Stock Manager, miembros del espacio de
 * trabajo configurado en ARCA_WORKSPACE, y con permiso para facturar (dueño/administrador del espacio,
 * o usuario Administrador/Encargado o con el permiso "Cobrar y facturar").
 *
 * Nunca duplica una factura: la app anota ANTES de enviar qué número va a pedir; si la respuesta se
 * pierde (corte de red, ARCA caída), al reintentar se consulta ese número en ARCA y, si ya estaba
 * autorizado con los mismos datos, se recupera el CAE en vez de pedir otro (ver docs/arca).
 *
 * Secretos / variables (Cloudflare → el Worker → Settings → Variables and Secrets):
 *   ARCA_CUIT            CUIT del emisor, 11 números sin guiones.
 *   ARCA_WORKSPACE       Id del espacio de trabajo de Stock Manager que puede facturar con ese CUIT.
 *   ARCA_HOMO_CERT       Certificado de HOMOLOGACIÓN (.crt, texto PEM completo).
 *   ARCA_HOMO_KEY        Clave privada de homologación (.key, PEM, sin contraseña).
 *   ARCA_PROD_CERT       Certificado de PRODUCCIÓN.
 *   ARCA_PROD_KEY        Clave privada de producción.
 *   ARCA_PROD_ENABLED    "si" para habilitar producción (facturas reales). Sin esto, sólo homologación.
 *   ARCA_TA              Binding de KV (Settings → Bindings → KV namespace) para guardar el Token. Recomendado.
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
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export const ENDPOINTS = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};
const WSFE_NS = 'http://ar.gov.afip.dif.FEV1/';
/** Tiempo máximo esperando a ARCA. Si se corta después de enviar, el resultado queda "incierto". */
const TIMEOUT_MS = 25_000;
/** RG 5700/2025: desde este importe hay que identificar al consumidor final (DNI/CUIT/CUIL). */
export const CF_ID_THRESHOLD = 10_000_000;

/** Tipos de comprobante (tabla de ARCA). */
export const CBTE = {
  FA: 1, NDA: 2, NCA: 3, FB: 6, NDB: 7, NCB: 8, FC: 11, NDC: 12, NCC: 13, FM: 51, NDM: 52, NCM: 53,
};
const CBTE_CLASS = { 1: 'A', 2: 'A', 3: 'A', 6: 'B', 7: 'B', 8: 'B', 11: 'C', 12: 'C', 13: 'C', 51: 'M', 52: 'M', 53: 'M' };
const IS_NOTE = new Set([2, 3, 7, 8, 12, 13, 52, 53]);
/** Alícuotas de IVA: porcentaje → Id de ARCA. */
export const IVA_ID = { 0: 3, 2.5: 9, 5: 8, 10.5: 4, 21: 5, 27: 6 };
/** Condición frente al IVA del receptor (FEParamGetCondicionIvaReceptor). */
export const COND_IVA = {
  1: 'IVA Responsable Inscripto', 4: 'IVA Sujeto Exento', 5: 'Consumidor Final', 6: 'Responsable Monotributo',
  7: 'Sujeto No Categorizado', 8: 'Proveedor del Exterior', 9: 'Cliente del Exterior', 10: 'IVA Liberado – Ley N° 19.640',
  13: 'Monotributista Social', 15: 'IVA No Alcanzado', 16: 'Monotributo Trabajador Independiente Promovido',
};

// ───────────────────────── utilidades ─────────────────────────

let jwksCache = { keys: null, until: 0 };
const memTA = new Map();

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
const reply = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });

class ArcaError extends Error {
  constructor(message, { status = 400, code, retryable = false, uncertain = false, log } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.uncertain = uncertain;
    this.log = log;
  }
}

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnescape = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#xD;|&#13;/g, '').replace(/&amp;/g, '&');

/** Contenido del primer <Nombre> (con o sin prefijo de namespace). */
export function tag(xml, name) {
  const m = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`).exec(xml ?? '');
  return m ? m[1] : undefined;
}
export function tags(xml, name) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'g');
  return [...String(xml ?? '').matchAll(re)].map((m) => m[1]);
}
const txt = (xml, name) => {
  const v = tag(xml, name);
  return v === undefined ? undefined : xmlUnescape(v.trim());
};
const num = (xml, name) => {
  const v = txt(xml, name);
  return v === undefined || v === '' ? undefined : Number(v);
};
const codeMsgs = (xml, wrapper, item) => tags(tag(xml, wrapper) ?? '', item).map((x) => ({ code: num(x, 'Code'), msg: txt(x, 'Msg') }));

/** Fecha de hoy en Argentina, AAAAMMDD. */
export function todayAR(now = Date.now()) {
  return new Date(now - 3 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
}
const isoAR = (ms) => `${new Date(ms - 3 * 3600_000).toISOString().slice(0, 19)}-03:00`;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Dígito verificador de CUIT/CUIL. */
export function validCuit(c) {
  const s = String(c ?? '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(s)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((a, x, i) => a + x * Number(s[i]), 0);
  let dv = 11 - (sum % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(s[10]);
}

// ───────────────────────── DER mínimo (para el CMS de WSAA) ─────────────────────────

function derLen(n) {
  if (n < 0x80) return Uint8Array.of(n);
  const b = [];
  while (n > 0) { b.unshift(n & 0xff); n >>= 8; }
  return Uint8Array.of(0x80 | b.length, ...b);
}
const der = (tagByte, ...content) => {
  const body = concat(...content);
  return concat(Uint8Array.of(tagByte), derLen(body.length), body);
};
const SEQ = (...c) => der(0x30, ...c);
const SET = (...c) => der(0x31, ...c);
const OCTETS = (b) => der(0x04, b);
const NULL = Uint8Array.of(0x05, 0x00);
const INT = (n) => der(0x02, Uint8Array.of(n));
const CTX = (n, ...c) => der(0xa0 + n, ...c);
function OID(dotted) {
  const p = dotted.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const b = [v & 0x7f];
    let x = Math.floor(v / 128);
    while (x > 0) { b.unshift((x & 0x7f) | 0x80); x = Math.floor(x / 128); }
    out.push(...b);
  }
  return der(0x06, Uint8Array.from(out));
}
function UTCTIME(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return der(0x17, new TextEncoder().encode(s));
}

/** Lee un elemento DER: { tag, start (contenido), end, raw }. */
export function derRead(buf, off = 0) {
  const t = buf[off];
  let len = buf[off + 1];
  let hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i];
    hdr = 2 + n;
  }
  const start = off + hdr;
  return { tag: t, start, end: start + len, raw: buf.subarray(off, start + len) };
}
export function derChildren(buf, el) {
  const out = [];
  for (let o = el.start; o < el.end;) {
    const c = derRead(buf, o);
    out.push(c);
    o = c.end;
  }
  return out;
}

const OIDS = {
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', sha256: '2.16.840.1.101.3.4.2.1', rsa: '1.2.840.113549.1.1.1',
  contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5',
};

function pemBody(pem, what) {
  const s = String(pem ?? '').replace(/\\n/g, '\n');
  if (/ENCRYPTED/.test(s)) throw new ArcaError(`La ${what} tiene contraseña: generala sin contraseña (ver docs/arca/CERTIFICADOS.md).`, { status: 500 });
  const body = s.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----/g, '').replace(/\s+/g, '');
  if (!body) throw new ArcaError(`Falta la ${what} en Cloudflare.`, { status: 500 });
  try {
    return b64ToBytes(body);
  } catch {
    throw new ArcaError(`La ${what} guardada en Cloudflare no se puede leer (¿se pegó completa?).`, { status: 500 });
  }
}

/** Datos del certificado: emisor y número de serie (para el CMS), CN, CUIT y vencimiento. */
export function certInfo(pem) {
  const bytes = pemBody(pem, 'certificado');
  const cert = derRead(bytes);
  const tbs = derChildren(bytes, cert)[0];
  const f = derChildren(bytes, tbs);
  const off = f[0].tag === 0xa0 ? 1 : 0;
  const serial = f[off];
  const issuer = f[off + 2];
  const validity = derChildren(bytes, f[off + 3]);
  const subject = f[off + 4];
  const time = (el) => {
    const s = new TextDecoder().decode(bytes.subarray(el.start, el.end));
    const full = el.tag === 0x17 ? `${Number(s.slice(0, 2)) < 50 ? '20' : '19'}${s}` : s;
    return `${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}T${full.slice(8, 10)}:${full.slice(10, 12)}:${full.slice(12, 14)}Z`;
  };
  const attrs = {};
  for (const rdn of derChildren(bytes, subject)) {
    for (const atv of derChildren(bytes, rdn)) {
      const [oid, val] = derChildren(bytes, atv);
      const o = [...bytes.subarray(oid.start, oid.end)].join('.');
      attrs[o] = new TextDecoder().decode(bytes.subarray(val.start, val.end));
    }
  }
  // 2.5.4.3 = CN (85.4.3), 2.5.4.5 = serialNumber (85.4.5)
  const cn = attrs['85.4.3'];
  const serialNumber = attrs['85.4.5'];
  return {
    der: bytes,
    issuer: issuer.raw,
    serial: serial.raw,
    cn,
    cuit: /(\d{11})/.exec(serialNumber ?? '')?.[1],
    notBefore: time(validity[0]),
    notAfter: time(validity[1]),
  };
}

/** Importa la clave privada (PKCS#8 o PKCS#1 "RSA PRIVATE KEY") para firmar con WebCrypto. */
async function importKey(pem) {
  let bytes = pemBody(pem, 'clave privada');
  if (/BEGIN RSA PRIVATE KEY/.test(String(pem))) {
    bytes = SEQ(INT(0), SEQ(OID(OIDS.rsa), NULL), OCTETS(bytes));
  }
  try {
    return await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new ArcaError('La clave privada guardada en Cloudflare no es válida (tiene que ser RSA, en formato PEM).', { status: 500 });
  }
}

/** Ticket de pedido de acceso (TRA) para un servicio de ARCA. */
export function buildTRA(service, now = Date.now()) {
  return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(now / 1000)}</uniqueId><generationTime>${isoAR(now - 10 * 60_000)}</generationTime><expirationTime>${isoAR(now + 10 * 60_000)}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
}

/** Firma el TRA en CMS SignedData (PKCS#7, SHA-256 + RSA) con el contenido adjunto, como pide WSAA. Devuelve base64. */
export async function signCMS(tra, certPem, keyPem, now = Date.now()) {
  const cert = certInfo(certPem);
  const key = await importKey(keyPem);
  const content = new TextEncoder().encode(tra);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', content));
  const attrs = [
    SEQ(OID(OIDS.contentType), SET(OID(OIDS.data))),
    SEQ(OID(OIDS.signingTime), SET(UTCTIME(now))),
    SEQ(OID(OIDS.messageDigest), SET(OCTETS(digest))),
  ].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  });
  const signedAttrsSet = SET(...attrs);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, signedAttrsSet));
  const signedAttrs = concat(Uint8Array.of(0xa0), signedAttrsSet.subarray(1)); // [0] IMPLICIT
  const signerInfo = SEQ(INT(1), SEQ(cert.issuer, cert.serial), SEQ(OID(OIDS.sha256), NULL), signedAttrs, SEQ(OID(OIDS.rsa), NULL), OCTETS(signature));
  const signedData = SEQ(
    INT(1),
    SET(SEQ(OID(OIDS.sha256), NULL)),
    SEQ(OID(OIDS.data), CTX(0, OCTETS(content))),
    CTX(0, cert.der),
    SET(signerInfo),
  );
  return bytesToB64(SEQ(OID(OIDS.signedData), CTX(0, signedData)));
}

// ───────────────────────── llamadas a ARCA ─────────────────────────

const redact = (xml) => String(xml).replace(/(<(?:\w+:)?Token>)[\s\S]*?(<\/)/g, '$1***$2').replace(/(<(?:\w+:)?Sign>)[\s\S]*?(<\/)/g, '$1***$2').replace(/(<(?:\w+:)?in0>)[\s\S]*?(<\/)/g, '$1***$2').replace(/(<token>|&lt;token&gt;)[\s\S]*?(<\/token>|&lt;\/token&gt;)/g, '$1***$2').replace(/(<sign>|&lt;sign&gt;)[\s\S]*?(<\/sign>|&lt;\/sign&gt;)/g, '$1***$2');

/** POST SOAP con tiempo máximo. Distingue "no se pudo enviar" de "se envió pero no llegó respuesta". */
async function soap(url, action, body, fetchImpl, log, op) {
  const t0 = Date.now();
  const entry = { op, at: new Date(t0).toISOString(), request: redact(body).slice(0, 20_000) };
  log.push(entry);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${action}"` }, body, signal: ctl.signal });
  } catch (e) {
    entry.ms = Date.now() - t0;
    entry.error = ctl.signal.aborted ? 'timeout' : String(e?.message ?? e);
    // Un corte después de enviar puede haber llegado a ARCA: el que llama decide si eso es "incierto".
    throw new ArcaError(ctl.signal.aborted ? 'ARCA no respondió a tiempo.' : 'No se pudo conectar con ARCA.', { status: 504, retryable: true, uncertain: true, code: 'network' });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  entry.ms = Date.now() - t0;
  entry.status = res.status;
  entry.response = redact(text).slice(0, 20_000);
  return { status: res.status, text };
}

const authXml = (ta, cuit) => `<ar:Auth><ar:Token>${xmlEscape(ta.token)}</ar:Token><ar:Sign>${xmlEscape(ta.sign)}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;
const envelope = (op, inner) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${WSFE_NS}"><soap:Header/><soap:Body><ar:${op}>${inner}</ar:${op}></soap:Body></soap:Envelope>`;

/** Ambiente pedido y sus credenciales. */
function credentials(env, ambiente) {
  if (ambiente !== 'homologacion' && ambiente !== 'produccion') throw new ArcaError('Ambiente inválido.');
  if (ambiente === 'produccion' && String(env.ARCA_PROD_ENABLED ?? '').toLowerCase() !== 'si')
    throw new ArcaError('Producción no está habilitada en el servicio de ARCA (falta ARCA_PROD_ENABLED = si en Cloudflare).', { status: 403, code: 'prod_disabled' });
  const cert = ambiente === 'produccion' ? env.ARCA_PROD_CERT : env.ARCA_HOMO_CERT;
  const key = ambiente === 'produccion' ? env.ARCA_PROD_KEY : env.ARCA_HOMO_KEY;
  if (!cert || !key) throw new ArcaError(`Falta cargar en Cloudflare el certificado y la clave de ${ambiente === 'produccion' ? 'producción' : 'homologación'}.`, { status: 500, code: 'no_cert' });
  const cuit = String(env.ARCA_CUIT ?? '').replace(/\D/g, '');
  if (!validCuit(cuit)) throw new ArcaError('Falta ARCA_CUIT (o no es un CUIT válido) en Cloudflare.', { status: 500, code: 'no_cuit' });
  return { cert, key, cuit, urls: ENDPOINTS[ambiente] };
}

const taKey = (ambiente, cuit) => `ta:wsfe:${ambiente}:${cuit}`;

/** Con KV, el Token se lee y guarda ahí (lo comparten todas las instancias); sin KV, en memoria. */
async function readTA(env, k, now) {
  let ta = null;
  if (env.ARCA_TA) {
    try { ta = await env.ARCA_TA.get(k, 'json'); } catch { ta = memTA.get(k) ?? null; }
  } else ta = memTA.get(k) ?? null;
  return ta && Date.parse(ta.expires) - now > 5 * 60_000 ? ta : null;
}
async function saveTA(env, k, ta) {
  memTA.set(k, ta);
  if (env.ARCA_TA) {
    const ttl = Math.max(60, Math.floor((Date.parse(ta.expires) - Date.now()) / 1000));
    try { await env.ARCA_TA.put(k, JSON.stringify(ta), { expirationTtl: ttl }); } catch { /* sigue en memoria */ }
  }
}
async function dropTA(env, k) {
  memTA.delete(k);
  if (env.ARCA_TA) { try { await env.ARCA_TA.delete(k); } catch { /* nada */ } }
}

/** Token y Sign de WSAA para wsfe (de KV si sigue vigente, si no, nuevo login). */
export async function getTA(env, ambiente, fetchImpl, log, now = Date.now()) {
  const c = credentials(env, ambiente);
  const k = taKey(ambiente, c.cuit);
  const cached = await readTA(env, k, now);
  if (cached) return cached;
  const cms = await signCMS(buildTRA('wsfe', now), c.cert, c.key, now);
  const body = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
  let r;
  try {
    r = await soap(c.urls.wsaa, '', body, fetchImpl, log, 'WSAA.loginCms');
  } catch (e) {
    throw new ArcaError(`${e.message} (autenticación WSAA)`, { status: 504, retryable: true, code: 'wsaa_network' });
  }
  const fault = txt(r.text, 'faultstring');
  if (fault || r.status >= 400) {
    const code = txt(r.text, 'faultcode') ?? '';
    if (/alreadyAuthenticated/i.test(code) || /ya posee un TA valido/i.test(fault ?? ''))
      throw new ArcaError('ARCA dice que ya hay un acceso vigente que este servicio no tiene guardado. Pasa solo cuando se pierde el token: configurá el KV ARCA_TA en Cloudflare y esperá hasta 12 h, o generá otro certificado (ver docs/arca/ERRORES_ARCA.md).', { status: 503, code: 'wsaa_already', retryable: false });
    if (/cms\.cert\.untrusted|cms\.bad|cms\.sign/i.test(code)) throw new ArcaError(`ARCA rechazó el certificado: ${fault}. Revisá que sea del ambiente correcto y esté vigente.`, { status: 502, code: 'wsaa_cert' });
    if (/notAuthorized|xml\.source\.invalid|cuit/i.test(code + fault)) throw new ArcaError(`ARCA no autorizó el acceso: ${fault}. Revisá que el certificado esté asociado al servicio "wsfe" (Factura electrónica) para ese CUIT.`, { status: 502, code: 'wsaa_auth' });
    throw new ArcaError(`Error de autenticación en ARCA: ${fault ?? `HTTP ${r.status}`}`, { status: 502, code: 'wsaa_error', retryable: r.status >= 500 });
  }
  const ret = xmlUnescape(txt(r.text, 'loginCmsReturn') ?? '');
  const token = txt(ret, 'token');
  const sign = txt(ret, 'sign');
  const expires = txt(ret, 'expirationTime');
  if (!token || !sign) throw new ArcaError('ARCA respondió el login sin Token/Sign.', { status: 502, code: 'wsaa_empty', retryable: true });
  const ta = { token, sign, expires: expires ? new Date(expires).toISOString() : new Date(now + 11 * 3600_000).toISOString() };
  await saveTA(env, k, ta);
  return ta;
}

/** Llama a una operación de WSFEv1 con Token/Sign (reintenta una vez si ARCA dice que el token no vale). */
async function wsfe(env, ambiente, op, inner, fetchImpl, log, { auth = true } = {}) {
  const c = credentials(env, ambiente);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ta = auth ? await getTA(env, ambiente, fetchImpl, log) : null;
    const r = await soap(c.urls.wsfe, `${WSFE_NS}${op}`, envelope(op, `${auth ? authXml(ta, c.cuit) : ''}${inner}`), fetchImpl, log, `WSFE.${op}`);
    const fault = txt(r.text, 'faultstring');
    if (fault) throw new ArcaError(`ARCA devolvió un error de servicio: ${fault}`, { status: 502, code: 'soap_fault', retryable: true });
    if (r.status >= 500 && !tag(r.text, `${op}Result`)) throw new ArcaError(`ARCA está con problemas (HTTP ${r.status}).`, { status: 502, code: 'http', retryable: true });
    const errs = codeMsgs(r.text, 'Errors', 'Err');
    if (auth && attempt === 0 && errs.some((e) => e.code === 600 || e.code === 601)) {
      await dropTA(env, taKey(ambiente, c.cuit));
      continue;
    }
    return { xml: r.text, errors: errs, events: codeMsgs(r.text, 'Events', 'Evt') };
  }
  throw new ArcaError('ARCA no aceptó el token de acceso.', { status: 502, code: 'auth' });
}

const infraError = (errs) => errs.find((e) => [500, 501, 502].includes(e.code));

export async function dummy(env, ambiente, fetchImpl, log) {
  const { xml } = await wsfe(env, ambiente, 'FEDummy', '', fetchImpl, log, { auth: false });
  return { app: txt(xml, 'AppServer'), db: txt(xml, 'DbServer'), auth: txt(xml, 'AuthServer') };
}

export async function lastAuthorized(env, ambiente, ptoVta, cbteTipo, fetchImpl, log) {
  const { xml, errors } = await wsfe(env, ambiente, 'FECompUltimoAutorizado', `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`, fetchImpl, log);
  const infra = infraError(errors);
  if (infra) throw new ArcaError(`ARCA está con problemas: ${infra.msg}`, { status: 502, code: `arca_${infra.code}`, retryable: true });
  if (errors.length) throw new ArcaError(errors.map((e) => `${e.code}: ${e.msg}`).join(' · '), { status: 422, code: `arca_${errors[0].code}` });
  return num(xml, 'CbteNro') ?? 0;
}

/** Consulta un comprobante. Devuelve null si no existe (error 602). */
export async function consult(env, ambiente, ptoVta, cbteTipo, nro, fetchImpl, log) {
  const { xml, errors } = await wsfe(env, ambiente, 'FECompConsultar', `<ar:FeCompConsReq><ar:CbteTipo>${cbteTipo}</ar:CbteTipo><ar:CbteNro>${nro}</ar:CbteNro><ar:PtoVta>${ptoVta}</ar:PtoVta></ar:FeCompConsReq>`, fetchImpl, log);
  if (errors.some((e) => e.code === 602)) return null;
  const infra = infraError(errors);
  if (infra) throw new ArcaError(`ARCA está con problemas: ${infra.msg}`, { status: 502, code: `arca_${infra.code}`, retryable: true });
  if (errors.length) throw new ArcaError(errors.map((e) => `${e.code}: ${e.msg}`).join(' · '), { status: 422, code: `arca_${errors[0].code}` });
  const g = tag(xml, 'ResultGet');
  if (!g) return null;
  return {
    nro: num(g, 'CbteDesde'),
    fecha: txt(g, 'CbteFch'),
    docTipo: num(g, 'DocTipo'),
    docNro: txt(g, 'DocNro'),
    impTotal: num(g, 'ImpTotal'),
    impNeto: num(g, 'ImpNeto'),
    impIva: num(g, 'ImpIVA'),
    resultado: txt(g, 'Resultado'),
    cae: txt(g, 'CodAutorizacion'),
    caeVto: txt(g, 'FchVto'),
    emisionTipo: txt(g, 'EmisionTipo'),
  };
}

export async function condicionesIva(env, ambiente, clase, fetchImpl, log) {
  const { xml, errors } = await wsfe(env, ambiente, 'FEParamGetCondicionIvaReceptor', `<ar:ClaseCmp>${clase}</ar:ClaseCmp>`, fetchImpl, log);
  if (errors.length) throw new ArcaError(errors.map((e) => `${e.code}: ${e.msg}`).join(' · '), { status: 422 });
  return tags(xml, 'CondicionIvaReceptor').map((x) => ({ id: num(x, 'Id'), desc: txt(x, 'Desc'), clase: txt(x, 'Cmp_Clase') }));
}

export async function puntosDeVenta(env, ambiente, fetchImpl, log) {
  const { xml, errors } = await wsfe(env, ambiente, 'FEParamGetPtosVenta', '', fetchImpl, log);
  if (errors.some((e) => e.code === 602)) return [];
  if (errors.length) throw new ArcaError(errors.map((e) => `${e.code}: ${e.msg}`).join(' · '), { status: 422 });
  return tags(xml, 'PtoVenta').map((x) => ({ nro: num(x, 'Nro'), tipo: txt(x, 'EmisionTipo'), bloqueado: txt(x, 'Bloqueado') === 'S', baja: txt(x, 'FchBaja') }));
}

// ───────────────────────── validación del comprobante ─────────────────────────

/**
 * Valida el comprobante tal como lo arma la app (los importes ya calculados) contra las reglas de
 * WSFEv1 que se pueden controlar antes de enviar. Devuelve la lista de problemas (vacía = ok).
 */
export function validateDoc(d, now = Date.now()) {
  const p = [];
  const clase = CBTE_CLASS[d.cbteTipo];
  if (!clase) p.push('Tipo de comprobante no soportado.');
  if (!Number.isInteger(d.ptoVta) || d.ptoVta < 1 || d.ptoVta > 99998) p.push('Punto de venta inválido.');
  if (!Number.isInteger(d.nro) || d.nro < 1 || d.nro > 99999999) p.push('Número de comprobante inválido.');
  if (![1, 2, 3].includes(d.concepto)) p.push('Concepto inválido (1 productos, 2 servicios, 3 ambos).');
  if (!/^\d{8}$/.test(d.fecha ?? '')) p.push('Fecha inválida (AAAAMMDD).');
  else {
    const today = todayAR(now);
    const toMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    const diff = Math.round((toMs(d.fecha) - toMs(today)) / 86_400_000);
    const lim = d.concepto === 1 ? 5 : 10;
    if (Math.abs(diff) > lim) p.push(`La fecha del comprobante tiene que estar entre ${lim} días antes y ${lim} después de hoy.`);
  }
  if (![80, 86, 96, 99].includes(d.docTipo)) p.push('Tipo de documento del receptor inválido.');
  const docNro = String(d.docNro ?? '').replace(/\D/g, '');
  if (d.docTipo === 99 && docNro !== '0') p.push('Consumidor final sin identificar: el documento tiene que ser 0.');
  if ((d.docTipo === 80 || d.docTipo === 86) && !validCuit(docNro)) p.push('El CUIT/CUIL del receptor no es válido.');
  if (d.docTipo === 96 && !/^\d{6,9}$/.test(docNro)) p.push('El DNI del receptor no es válido.');
  if ((clase === 'A' || clase === 'M') && d.docTipo !== 80) p.push('Las facturas A (y M) requieren el CUIT del receptor.');
  if (!COND_IVA[d.condicionIvaReceptor]) p.push('Falta la condición frente al IVA del receptor.');
  if ((clase === 'A' || clase === 'M') && ![1, 6, 13, 16].includes(d.condicionIvaReceptor)) p.push('La condición frente al IVA del receptor no corresponde a una factura A.');
  if (clase === 'B' && [1].includes(d.condicionIvaReceptor)) p.push('A un Responsable Inscripto corresponde factura A, no B.');
  if (clase === 'B' && d.docTipo === 99 && d.impTotal >= CF_ID_THRESHOLD) p.push(`Desde $ ${CF_ID_THRESHOLD.toLocaleString('es-AR')} hay que identificar al consumidor final (DNI, CUIT o CUIL).`);

  const money = ['impTotal', 'impNeto', 'impIva', 'impTotConc', 'impOpEx', 'impTrib'];
  for (const k of money) {
    const v = d[k] ?? 0;
    if (!Number.isFinite(v) || v < 0 || round2(v) !== v) p.push(`Importe inválido: ${k}.`);
  }
  if (!(d.impTotal > 0)) p.push('El total tiene que ser mayor a cero.');
  const sum = round2((d.impNeto ?? 0) + (d.impIva ?? 0) + (d.impTotConc ?? 0) + (d.impOpEx ?? 0) + (d.impTrib ?? 0));
  if (sum !== round2(d.impTotal)) p.push(`El total (${d.impTotal}) no coincide con neto + IVA + otros (${sum}).`);
  const iva = d.iva ?? [];
  if (clase === 'C') {
    if (iva.length || d.impIva) p.push('Las facturas C no discriminan IVA.');
  } else {
    if (!iva.length) p.push('Falta el detalle de IVA.');
    const ids = new Set(Object.values(IVA_ID));
    let base = 0;
    let imp = 0;
    for (const a of iva) {
      if (!ids.has(a.id)) p.push(`Alícuota de IVA inválida (${a.id}).`);
      const rate = Number(Object.keys(IVA_ID).find((r) => IVA_ID[r] === a.id));
      if (Math.abs(round2(a.baseImp * rate / 100) - a.importe) > 0.01 + iva.length * 0.005) p.push(`El IVA ${rate}% no coincide con su base imponible.`);
      base += a.baseImp;
      imp += a.importe;
    }
    if (round2(base) !== round2(d.impNeto)) p.push('La suma de las bases de IVA no coincide con el neto gravado.');
    if (round2(imp) !== round2(d.impIva)) p.push('La suma del IVA no coincide con el IVA total.');
  }
  if (IS_NOTE.has(d.cbteTipo)) {
    const a = d.asociado;
    if (!a || !CBTE_CLASS[a.cbteTipo] || !Number.isInteger(a.ptoVta) || !Number.isInteger(a.nro)) p.push('Las notas de crédito/débito tienen que indicar el comprobante asociado.');
    else if (CBTE_CLASS[a.cbteTipo] !== clase) p.push('El comprobante asociado tiene que ser de la misma letra.');
  }
  return p;
}

/** Arma el FECAESolicitar de un comprobante validado. */
export function buildCAERequest(d, cuitEmisor) {
  const iva = (d.iva ?? []).map((a) => `<ar:AlicIva><ar:Id>${a.id}</ar:Id><ar:BaseImp>${a.baseImp.toFixed(2)}</ar:BaseImp><ar:Importe>${a.importe.toFixed(2)}</ar:Importe></ar:AlicIva>`).join('');
  const serv = d.concepto === 1 ? '' : `<ar:FchServDesde>${d.fchServDesde ?? d.fecha}</ar:FchServDesde><ar:FchServHasta>${d.fchServHasta ?? d.fecha}</ar:FchServHasta><ar:FchVtoPago>${d.fchVtoPago ?? d.fecha}</ar:FchVtoPago>`;
  const asoc = d.asociado
    ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${d.asociado.cbteTipo}</ar:Tipo><ar:PtoVta>${d.asociado.ptoVta}</ar:PtoVta><ar:Nro>${d.asociado.nro}</ar:Nro><ar:Cuit>${cuitEmisor}</ar:Cuit>${d.asociado.fecha ? `<ar:CbteFch>${d.asociado.fecha}</ar:CbteFch>` : ''}</ar:CbteAsoc></ar:CbtesAsoc>`
    : '';
  return `<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${d.ptoVta}</ar:PtoVta><ar:CbteTipo>${d.cbteTipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>`
    + `<ar:Concepto>${d.concepto}</ar:Concepto><ar:DocTipo>${d.docTipo}</ar:DocTipo><ar:DocNro>${String(d.docNro).replace(/\D/g, '') || '0'}</ar:DocNro>`
    + `<ar:CbteDesde>${d.nro}</ar:CbteDesde><ar:CbteHasta>${d.nro}</ar:CbteHasta><ar:CbteFch>${d.fecha}</ar:CbteFch>`
    + `<ar:ImpTotal>${d.impTotal.toFixed(2)}</ar:ImpTotal><ar:ImpTotConc>${(d.impTotConc ?? 0).toFixed(2)}</ar:ImpTotConc><ar:ImpNeto>${d.impNeto.toFixed(2)}</ar:ImpNeto>`
    + `<ar:ImpOpEx>${(d.impOpEx ?? 0).toFixed(2)}</ar:ImpOpEx><ar:ImpTrib>${(d.impTrib ?? 0).toFixed(2)}</ar:ImpTrib><ar:ImpIVA>${(d.impIva ?? 0).toFixed(2)}</ar:ImpIVA>`
    + `${serv}<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${d.condicionIvaReceptor}</ar:CondicionIVAReceptorId>`
    + `${asoc}${iva ? `<ar:Iva>${iva}</ar:Iva>` : ''}`
    + '</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>';
}

/**
 * ¿El comprobante que está en ARCA con ese número es éste? (mismo total y receptor). La fecha no se
 * compara: la app la actualiza en cada intento (y la anota antes de enviar).
 */
export function sameDoc(found, d) {
  return !!found && found.resultado !== 'R'
    && Math.abs((found.impTotal ?? -1) - d.impTotal) < 0.005
    && found.docTipo === d.docTipo
    && String(found.docNro ?? '').replace(/^0+/, '') === (String(d.docNro).replace(/\D/g, '').replace(/^0+/, ''));
}

/**
 * Pide el CAE de un comprobante SIN DUPLICAR. La app manda el número que anotó antes de enviar (d.nro):
 *  - si ese número ya está en ARCA y es este comprobante → se devuelve ese CAE (recuperado);
 *  - si lo tomó otro comprobante o no es el siguiente → { status: 'renumerar', next } para que la app lo anote y reintente;
 *  - si es el siguiente → se pide el CAE. Si la respuesta no llega → { status: 'incierta' } (reintentar consulta).
 */
export async function emit(env, ambiente, d, fetchImpl, log, now = Date.now()) {
  const problems = validateDoc(d, now);
  if (problems.length) return { status: 'invalida', problems };
  const c = credentials(env, ambiente);
  const last = await lastAuthorized(env, ambiente, d.ptoVta, d.cbteTipo, fetchImpl, log);
  if (d.nro <= last) {
    const found = await consult(env, ambiente, d.ptoVta, d.cbteTipo, d.nro, fetchImpl, log);
    if (sameDoc(found, d)) return { status: 'autorizada', recovered: true, nro: d.nro, cae: found.cae, caeVto: found.caeVto, fecha: found.fecha, obs: [] };
    return { status: 'renumerar', next: last + 1, reason: 'El número ya lo usó otro comprobante.' };
  }
  if (d.nro !== last + 1) return { status: 'renumerar', next: last + 1, reason: 'No es el número siguiente.' };

  let r;
  try {
    r = await wsfe(env, ambiente, 'FECAESolicitar', buildCAERequest(d, c.cuit), fetchImpl, log);
  } catch (e) {
    if (e instanceof ArcaError && e.uncertain) return { status: 'incierta', nro: d.nro, message: `${e.message} No se sabe si ARCA lo autorizó: reintentá y se consulta antes de volver a pedirlo.` };
    if (e instanceof ArcaError && e.code === 'soap_fault') return { status: 'error', retryable: true, message: e.message };
    throw e;
  }
  const det = tag(r.xml, 'FEDetResponse') ?? tag(r.xml, 'FECAEDetResponse') ?? '';
  const resultado = txt(det, 'Resultado') ?? txt(r.xml, 'Resultado');
  const obs = codeMsgs(det, 'Observaciones', 'Obs');
  const cae = txt(det, 'CAE');
  if (resultado === 'A' && /^\d{14}$/.test(cae ?? '')) {
    return { status: 'autorizada', nro: num(det, 'CbteDesde') ?? d.nro, cae, caeVto: txt(det, 'CAEFchVto'), fecha: txt(det, 'CbteFch') ?? d.fecha, obs, events: r.events };
  }
  const infra = infraError(r.errors);
  if (infra) return { status: 'incierta', nro: d.nro, message: `ARCA está con problemas (${infra.code}: ${infra.msg}). No se sabe si lo autorizó: reintentá más tarde.` };
  // Otro dispositivo tomó el número en el medio.
  if ([...r.errors, ...obs].some((e) => e.code === 10016) && resultado !== 'A') {
    const again = await lastAuthorized(env, ambiente, d.ptoVta, d.cbteTipo, fetchImpl, log);
    if (again >= d.nro) return { status: 'renumerar', next: again + 1, reason: 'Otro dispositivo usó ese número.' };
  }
  return { status: 'rechazada', nro: d.nro, errors: r.errors, obs, events: r.events };
}

// ───────────────────────── sesión y permisos ─────────────────────────

async function googleKeys(fetchImpl) {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const r = await fetchImpl(JWKS_URL);
  if (!r.ok) throw new Error('No se pudieron obtener las claves de Google.');
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get('Cache-Control') ?? '')?.[1] ?? 3600);
  const { keys } = await r.json();
  jwksCache = { keys, until: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return keys;
}

/** Verifica el token de sesión de Firebase (firma RS256 de Google, proyecto, vencimiento). */
export async function verifyIdToken(token, fetchImpl = fetch, now = Date.now()) {
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
  return { uid: payload.sub, email: String(payload.email ?? '').toLowerCase() };
}

const BILLING_ROLES = ['admin', 'manager'];

/**
 * ¿Puede facturar? Miembro del espacio Y (dueño/administrador del espacio, o su usuario de Stock
 * Manager es Administrador/Encargado o tiene el permiso "billing"). Todo leído con SU sesión, así
 * las reglas de Firestore deciden qué puede ver.
 */
export async function canBill(wsId, token, user, fetchImpl = fetch) {
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(wsId ?? '')) return { ok: false, reason: 'Espacio de trabajo inválido.' };
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const r = await fetchImpl(`${base}/workspaces/${wsId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { ok: false, reason: 'No sos miembro de este espacio de trabajo.' };
  const doc = await r.json();
  const members = (doc?.fields?.memberUids?.arrayValue?.values ?? []).map((v) => v.stringValue);
  if (!members.includes(user.uid)) return { ok: false, reason: 'No sos miembro de este espacio de trabajo.' };
  const role = doc?.fields?.roles?.mapValue?.fields?.[user.uid]?.stringValue;
  if (role === 'owner' || role === 'admin') return { ok: true, name: user.email };
  if (!user.email) return { ok: false, reason: 'Tu usuario no tiene permiso para facturar.' };
  const q = await fetchImpl(`${base}/workspaces/${wsId}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: user.email } } }, limit: 1 } }),
  });
  if (!q.ok) return { ok: false, reason: 'No se pudieron leer tus permisos.' };
  const rows = await q.json();
  const f = (Array.isArray(rows) ? rows : []).find((x) => x.document)?.document?.fields;
  if (!f || f.active?.booleanValue === false) return { ok: false, reason: 'Tu usuario no tiene permiso para facturar.' };
  const urole = f.role?.stringValue;
  const perms = (f.permissions?.arrayValue?.values ?? []).map((v) => v.stringValue);
  if (BILLING_ROLES.includes(urole) || (urole === 'custom' && (perms.includes('billing') || perms.includes('admin'))))
    return { ok: true, name: f.name?.stringValue ?? user.email };
  return { ok: false, reason: 'Tu usuario no tiene permiso para facturar.' };
}

// ───────────────────────── rutas ─────────────────────────

const ROUTES = new Set(['/status', '/last', '/emit', '/consult', '/params']);

export async function handle(request, env, fetchImpl = fetch, now = Date.now()) {
  const origin = request.headers.get('Origin') ?? '';
  const h = cors(origin);
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (path === '/health' || path === '/') {
    return reply(200, {
      ok: true,
      servicio: 'Stock Manager · ARCA',
      cuit: validCuit(env.ARCA_CUIT) ? `${String(env.ARCA_CUIT).slice(0, 2)}-…-${String(env.ARCA_CUIT).slice(-1)}` : null,
      homologacion: !!(env.ARCA_HOMO_CERT && env.ARCA_HOMO_KEY),
      produccion: !!(env.ARCA_PROD_CERT && env.ARCA_PROD_KEY) && String(env.ARCA_PROD_ENABLED ?? '').toLowerCase() === 'si',
      kv: !!env.ARCA_TA,
    }, h);
  }
  if (!ROUTES.has(path) || request.method !== 'POST') return reply(404, { message: 'No existe.' }, h);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply(403, { message: 'Origen no permitido.' }, h);

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let user;
  try {
    user = await verifyIdToken(token, fetchImpl, now);
  } catch (e) {
    return reply(401, { message: e.message }, h);
  }
  const ws = request.headers.get('X-Workspace') ?? '';
  if (!env.ARCA_WORKSPACE) return reply(500, { message: 'Falta ARCA_WORKSPACE en Cloudflare (el espacio de trabajo que puede facturar).' }, h);
  if (ws !== env.ARCA_WORKSPACE) return reply(403, { message: 'Este espacio de trabajo no está habilitado para facturar con este CUIT.' }, h);
  const perm = await canBill(ws, token, user, fetchImpl);
  if (!perm.ok) return reply(403, { message: perm.reason }, h);

  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, { message: 'Pedido inválido.' }, h);
  }
  const ambiente = body?.ambiente;
  const log = [];
  try {
    if (path === '/status') {
      const out = { cuit: String(env.ARCA_CUIT ?? ''), kv: !!env.ARCA_TA, ambiente, prodEnabled: String(env.ARCA_PROD_ENABLED ?? '').toLowerCase() === 'si' };
      for (const amb of ['homologacion', 'produccion']) {
        const pem = amb === 'produccion' ? env.ARCA_PROD_CERT : env.ARCA_HOMO_CERT;
        if (!pem) { out[amb] = { cert: false }; continue; }
        try {
          const ci = certInfo(pem);
          out[amb] = { cert: true, cn: ci.cn, cuit: ci.cuit, desde: ci.notBefore, vence: ci.notAfter, key: !!(amb === 'produccion' ? env.ARCA_PROD_KEY : env.ARCA_HOMO_KEY) };
        } catch (e) {
          out[amb] = { cert: true, error: e.message };
        }
      }
      if (body?.probar) {
        out.servidores = await dummy(env, ambiente, fetchImpl, log);
        await getTA(env, ambiente, fetchImpl, log, now);
        out.autenticacion = 'ok';
        if (Number.isInteger(body.ptoVta)) {
          try { out.puntosDeVenta = await puntosDeVenta(env, ambiente, fetchImpl, log); } catch (e) { out.puntosDeVentaError = e.message; }
          out.ultimoFB = await lastAuthorized(env, ambiente, body.ptoVta, CBTE.FB, fetchImpl, log);
        }
      }
      return reply(200, { ...out, log }, h);
    }
    if (path === '/last') {
      const nro = await lastAuthorized(env, ambiente, body.ptoVta, body.cbteTipo, fetchImpl, log);
      return reply(200, { nro, log }, h);
    }
    if (path === '/consult') {
      const found = await consult(env, ambiente, body.ptoVta, body.cbteTipo, body.nro, fetchImpl, log);
      return reply(200, { found, log }, h);
    }
    if (path === '/params') {
      const cond = await condicionesIva(env, ambiente, body.clase ?? 'B', fetchImpl, log);
      return reply(200, { condicionesIva: cond, log }, h);
    }
    // /emit
    const result = await emit(env, ambiente, body.doc ?? {}, fetchImpl, log, now);
    return reply(result.status === 'invalida' ? 422 : 200, { ...result, by: perm.name, log }, h);
  } catch (e) {
    if (e instanceof ArcaError) return reply(e.status, { message: e.message, code: e.code, retryable: e.retryable, log }, h);
    return reply(500, { message: `Error inesperado: ${e?.message ?? e}`, log }, h);
  }
}

export default { fetch: (request, env) => handle(request, env) };

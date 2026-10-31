/**
 * Lectura de facturas con IA (etapa 1): se manda la foto a la función de la nube, que la lee con
 * Claude, y acá se decide a qué producto del catálogo corresponde cada renglón y cuánto suma en
 * la unidad de stock. Nada se carga al stock sin que una persona lo revise.
 */
import { buildGeminiRequest, buildRequest, geminiText, parseReading } from '../../functions/reader.mjs';
import { callCloudFunction, cloudSession } from '../cloud/cloudService';
import type { InvoiceItem, Product } from '../models';
import { normalize, round3 } from '../utils/format';
import { uuid } from '../utils/id';

/** Lo que devuelve la función de la nube (ver functions/reader.mjs). */
export interface AIReading {
  supplier: { name: string | null; cuit: string | null };
  invoice: { kind: string | null; number: string | null; date: string | null; total: number | null };
  lines: { description: string; code: string | null; quantity: number; unit: string | null; packSize?: number | null; unitPrice: number | null; lineTotal: number | null; ref: string | null; confidence: 'alta' | 'media' | 'baja' | 'ninguna' }[];
  warnings: string[];
  model?: string;
}

export interface CatalogLookups {
  unit: (id?: string) => string;
}

export interface InvoiceReadResult {
  supplierName?: string;
  number?: string;
  date?: string;
  total?: number;
  items: InvoiceItem[];
  warnings: string[];
}

type Reader = (data: { images: { type: string; data: string }[]; catalog: CatalogEntry[] }) => Promise<AIReading>;
export interface CatalogEntry { ref: string; name: string; unit: string; buy: string }

/** Catálogo compacto para la IA: referencias cortas en vez de ids largos (menos texto, menos costo). */
export function buildCatalog(products: Product[], lk: CatalogLookups): { catalog: CatalogEntry[]; byRef: Map<string, string> } {
  const byRef = new Map<string, string>();
  const catalog = products
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((p, i) => {
      const ref = (i + 1).toString(36);
      byRef.set(ref, p.id);
      const buyUnit = p.purchaseUnitId ? lk.unit(p.purchaseUnitId) : '';
      return { ref, name: p.name, unit: lk.unit(p.unitId) || 'u', buy: buyUnit && p.purchaseFactor > 1 ? `${buyUnit} x${p.purchaseFactor}` : '' };
    });
  return { catalog, byRef };
}

/** Lee las fotos. En las pruebas automáticas se puede reemplazar el lector (window.__smInvoiceReader). */
export async function readInvoicePhotos(images: { type: string; data: string }[], products: Product[], lk: CatalogLookups, opts: { readerUrl?: string } = {}): Promise<InvoiceReadResult> {
  if (!images.length) throw new Error('Sacá o elegí al menos una foto de la factura.');
  if (images.length > 6) throw new Error('Para leer con IA, máximo 6 hojas por factura.');
  const { catalog, byRef } = buildCatalog(products, lk);
  const override = (globalThis as { __smInvoiceReader?: Reader }).__smInvoiceReader;
  const reading = override
    ? await override({ images, catalog })
    : opts.readerUrl
      ? await readViaWorker(opts.readerUrl, images, catalog)
      : await readViaFirebase(images, catalog);
  return {
    supplierName: reading.supplier?.name ?? undefined,
    number: reading.invoice?.number ?? undefined,
    date: reading.invoice?.date ?? undefined,
    total: reading.invoice?.total ?? undefined,
    items: matchLines(reading.lines ?? [], products, lk, byRef),
    warnings: reading.warnings ?? [],
  };
}

/** Sin servidor de Cloudflare configurado: función de Firebase (requiere el plan Blaze; ver docs/firebase.md). */
async function readViaFirebase(images: { type: string; data: string }[], catalog: CatalogEntry[]): Promise<AIReading> {
  try {
    return await callCloudFunction<AIReading>('readInvoice', { images, catalog });
  } catch (e) {
    if (e instanceof Error && /no está instalada/.test(e.message)) {
      throw new Error('Falta configurar la lectura con IA: Configuración → Lectura con IA.', { cause: e });
    }
    throw e;
  }
}

/** Errores del servidor o de la API de Claude, en castellano. */
function readerError(status: number, body: unknown): Error {
  const b = body as { error?: string | { type?: string; message?: string } } | null;
  const own = typeof b?.error === 'string' ? b.error : undefined;
  if (own) return new Error(own); // mensaje del servidor de Cloudflare
  const type = typeof b?.error === 'object' ? b.error?.type : undefined;
  if (status === 401 || type === 'authentication_error') return new Error('La clave de Anthropic no es válida. Revisala en Cloudflare (secreto ANTHROPIC_API_KEY).');
  if (status === 403 || type === 'permission_error') return new Error('La clave de Anthropic no tiene permiso para usar este modelo.');
  if (status === 402 || /credit|billing/i.test(typeof b?.error === 'object' ? b.error?.message ?? '' : '')) return new Error('La cuenta de Anthropic no tiene saldo. Cargá crédito en console.anthropic.com.');
  if (status === 429 || status === 529 || type === 'overloaded_error' || type === 'rate_limit_error') return new Error('El servicio de IA está ocupado. Probá de nuevo en un minuto.');
  if (status === 413 || type === 'request_too_large') return new Error('Las fotos son demasiado grandes. Probá con menos hojas.');
  if (status === 400) return new Error('La IA no pudo procesar estas fotos.');
  return new Error(`No se pudo leer la factura (error ${status}). Probá de nuevo.`);
}

/** Errores de Gemini (Google), en castellano. */
function geminiError(status: number, body: unknown): Error {
  const b = body as { error?: string | { message?: string; status?: string } } | null;
  if (typeof b?.error === 'string') return new Error(b.error); // mensaje del servidor de Cloudflare
  const msg = typeof b?.error === 'object' ? `${b.error?.status ?? ''} ${b.error?.message ?? ''}` : '';
  if (/API key not valid|API_KEY_INVALID/i.test(msg)) return new Error('La clave de Google no es válida. Revisala en Cloudflare (secreto GEMINI_API_KEY).');
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(msg)) return new Error('Se alcanzó el límite gratis de Gemini por ahora. Probá de nuevo en un rato.');
  if (status === 403 || /PERMISSION_DENIED/.test(msg)) return new Error('La clave de Google no tiene permiso para usar Gemini.');
  if (status === 404) return new Error('El modelo de Gemini no está disponible. Revisá el secreto GEMINI_MODEL en Cloudflare.');
  if (status === 413) return new Error('Las fotos son demasiado grandes. Probá con menos hojas.');
  if (status === 400) return new Error('La IA no pudo procesar estas fotos.');
  const detail = typeof b?.error === 'object' && b.error?.message ? b.error.message.replace(/\s+/g, ' ').slice(0, 160) : '';
  if (status >= 500 && (/overloaded|UNAVAILABLE|try again later/i.test(msg) || !detail)) return new Error('Gemini está saturado en este momento (en el plan gratis pasa en horas pico). Probá de nuevo en un minuto.');
  return new Error(`No se pudo leer la factura (error ${status}${detail ? `: ${detail}` : ''}). Probá de nuevo; si se repite, mandale este mensaje a Claude.`);
}

/** Qué IA tiene configurada el servidor (se consulta una vez cada 10 minutos). */
const providerCache = new Map<string, { provider: 'gemini' | 'anthropic'; model?: string; until: number }>();
export async function workerProvider(url: string): Promise<'gemini' | 'anthropic'> {
  const hit = providerCache.get(url);
  if (hit && hit.until > Date.now()) return hit.provider;
  const r = await testReader(url);
  if (!r.configured) throw new Error('El servidor de lectura no tiene ninguna clave cargada (GEMINI_API_KEY o ANTHROPIC_API_KEY).');
  const provider = r.provider === 'anthropic' ? 'anthropic' : 'gemini';
  providerCache.set(url, { provider, model: r.model, until: Date.now() + 10 * 60_000 });
  return provider;
}

/** Modelo que informa el servidor (después de workerProvider); undefined si no lo informa. */
export function workerModel(url: string): string | undefined {
  return providerCache.get(url)?.model;
}

const READ_RETRY_WAITS_MS = [2000, 5000];

/** Lectura a través del servidor de Cloudflare: el pedido se arma acá y el servidor sólo agrega la clave. */
async function readViaWorker(rawUrl: string, images: { type: string; data: string }[], catalog: CatalogEntry[]): Promise<AIReading> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Sin conexión: la lectura con IA necesita Internet.');
  const url = rawUrl.replace(/\/+$/, '');
  const provider = await workerProvider(url);
  const { token, wsId } = await cloudSession();
  const payload = JSON.stringify(provider === 'gemini' ? buildGeminiRequest(images, catalog) : buildRequest(images, catalog));
  let r: Response;
  let body: unknown;
  // Si la IA responde "saturado" (5xx), se reintenta un par de veces antes de avisar.
  for (let attempt = 0; ; attempt++) {
    try {
      r = await fetch(provider === 'gemini' ? `${url}/gemini` : url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Workspace': wsId },
        body: payload,
      });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor de lectura. Revisá la dirección en Configuración → Lectura con IA.', { cause: e });
    }
    body = await r.json().catch(() => null);
    if (r.ok || r.status < 500 || attempt >= READ_RETRY_WAITS_MS.length) break;
    await new Promise((res) => setTimeout(res, READ_RETRY_WAITS_MS[attempt]));
  }
  if (provider === 'gemini') {
    if (!r.ok) throw geminiError(r.status, body);
    const { text, truncated } = geminiText(body);
    const reading = parseReading(text, catalog.map((c) => c.ref)) as AIReading;
    if (truncated) reading.warnings.push('La factura es muy larga: puede faltar algún renglón al final.');
    return reading;
  }
  if (!r.ok) throw readerError(r.status, body);
  const msg = body as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (msg.stop_reason === 'refusal') throw new Error('La IA no procesó estas fotos.');
  const text = (msg.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const reading = parseReading(text, catalog.map((c) => c.ref)) as AIReading;
  if (msg.stop_reason === 'max_tokens') reading.warnings.push('La factura es muy larga: puede faltar algún renglón al final.');
  return reading;
}

/** Prueba de conexión con el servidor (Configuración → Lectura con IA). */
export async function testReader(url: string): Promise<{ configured: boolean; provider?: 'gemini' | 'anthropic'; model?: string }> {
  let r: Response;
  try {
    r = await fetch(url.replace(/\/+$/, ''), { method: 'GET' });
  } catch (e) {
    throw new Error('No se pudo conectar. Revisá que la dirección esté bien copiada.', { cause: e });
  }
  const b = (await r.json().catch(() => null)) as { service?: string; configured?: boolean; provider?: string | null; model?: string } | null;
  if (!r.ok || b?.service !== 'stock-manager-invoice-reader') throw new Error('Esa dirección no es el servidor de lectura de Stock Manager.');
  // Servidores viejos (sólo Claude) no informan `provider`.
  const provider = b.provider === 'gemini' ? 'gemini' : b.provider === 'anthropic' || (b.configured && !('provider' in b)) ? 'anthropic' : undefined;
  return { configured: !!b.configured, provider, model: b.model };
}

// ───────────── Reconocimiento de productos ─────────────

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'x', 'con', 'por', 'en', 'y', 'a', 'p', 'para', 'sin', 'un', 'una']);
const UNIT_ALIASES: [RegExp, string][] = [
  [/^(l|lt|lts|ltr|litro|litros)$/, 'l'],
  [/^(ml|cc|cm3)$/, 'ml'],
  [/^(kg|kgs|kilo|kilos|k)$/, 'kg'],
  [/^(g|gr|grs|gramo|gramos)$/, 'g'],
  [/^(u|un|uni|unid|unidad|unidades)$/, 'u'],
];
const canonUnit = (u: string) => UNIT_ALIASES.find(([re]) => re.test(u))?.[1] ?? u;

/** Palabras clave de un nombre: minúsculas, sin acentos, tamaños juntos ("2,25 lt" → "2.25l"). */
export function tokens(text: string): string[] {
  const t = normalize(text)
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\bx\s*(\d)/g, ' $1')
    .replace(/(\d+(?:\.\d+)?)\s*(l|lt|lts|ltr|litros?|ml|cc|kg|kgs|kilos?|g|gr|grs|gramos?)\b/g, (_, n: string, u: string) => ` ${Number(n)}${canonUnit(u)} `)
    .replace(/[^a-z0-9.]+/g, ' ');
  return t.split(' ').map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w && !STOP.has(w));
}

const isSize = (w: string) => /^\d+(\.\d+)?(l|ml|kg|g)$/.test(w);
/** Tamaño en unidad base (litros o kilos) para comparar "1500ml" con "1.5l". */
function sizeValue(w: string): string {
  const m = /^(\d+(?:\.\d+)?)(l|ml|kg|g)$/.exec(w);
  if (!m) return w;
  const n = Number(m[1]);
  return m[2] === 'ml' ? `${n / 1000}l` : m[2] === 'g' ? `${n / 1000}kg` : `${n}${m[2]}`;
}

/** Parecido entre dos nombres (0 a 1). Tamaños distintos ("1,5 L" vs "2,25 L") bajan mucho el puntaje. */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  const sizesA = new Set(A.filter(isSize).map(sizeValue));
  const sizesB = new Set(B.filter(isSize).map(sizeValue));
  const wordsA = A.filter((w) => !isSize(w));
  const wordsB = B.filter((w) => !isSize(w));
  let hit = 0;
  const used = new Set<number>();
  for (const w of wordsB) {
    let best = 0;
    let at = -1;
    wordsA.forEach((x, i) => {
      if (used.has(i)) return;
      const s = x === w ? 1 : (x.length >= 3 && w.length >= 3 && (x.startsWith(w) || w.startsWith(x))) ? 0.8 : 0;
      if (s > best) { best = s; at = i; }
    });
    if (at >= 0) used.add(at);
    hit += best;
  }
  // Qué parte del nombre del catálogo aparece en la factura (las facturas suelen agregar marca, códigos…).
  let score = wordsB.length ? hit / wordsB.length : 0;
  // Un poco de castigo si la factura tiene muchas palabras que el catálogo no menciona.
  score *= 0.85 + 0.15 * (hit / Math.max(wordsA.length, 1));
  if (sizesA.size && sizesB.size) score *= [...sizesB].some((s) => sizesA.has(s)) ? 1.05 : 0.45;
  return Math.min(1, score);
}

const PACK_WORDS = /^(caja|cajas|cj|cja|caj|b|bu|bul|bult|bulto|bultos|bto|btos|pack|packs|pk|fardo|fardos|fdo|bolsa|bolsas|bls|display|paquete|paquetes|paq|pqt|blister|maple|cajon)$/;

/** El renglón viene en cajas, bultos, packs… (no en la unidad de stock). */
export function isPackUnit(invoiceUnit: string | null | undefined): boolean {
  return PACK_WORDS.test(normalize(invoiceUnit ?? '').replace(/\./g, ''));
}

/** Unidades por caja/bulto que corresponden: las del producto si las tiene cargadas; si no, las de la factura. */
export function packFactor(product: Pick<Product, 'purchaseFactor'>, packSize?: number | null): number {
  return product.purchaseFactor > 1 ? product.purchaseFactor : packSize && packSize > 1 ? packSize : 1;
}

/** Cantidad en la unidad de stock del producto según la unidad de la factura. */
export function toStockQty(quantity: number, invoiceUnit: string | null | undefined, product: Product, lk: CatalogLookups, packSize?: number | null): number {
  const u = canonUnit(normalize(invoiceUnit ?? '').replace(/\./g, ''));
  const stockUnit = canonUnit(normalize(lk.unit(product.unitId)));
  const buyUnit = product.purchaseUnitId ? canonUnit(normalize(lk.unit(product.purchaseUnitId))) : '';
  if (u && stockUnit && u !== stockUnit) {
    if (u === 'kg' && stockUnit === 'g') return round3(quantity * 1000);
    if (u === 'g' && stockUnit === 'kg') return round3(quantity / 1000);
    if (u === 'l' && stockUnit === 'ml') return round3(quantity * 1000);
    if (u === 'ml' && stockUnit === 'l') return round3(quantity / 1000);
    if (/^(docena|docenas|doc|dz)$/.test(u) && stockUnit === 'u') return round3(quantity * 12);
  }
  if (u && u !== stockUnit && (u === buyUnit || PACK_WORDS.test(u))) return round3(quantity * packFactor(product, packSize));
  return round3(quantity);
}

/**
 * El renglón viene en cajas/bultos y no se sabe cuántas unidades trae cada uno (ni el producto lo
 * tiene cargado ni la factura lo dice): hay que preguntarlo antes de cargar al stock.
 */
export function needsPackSize(item: Pick<InvoiceItem, 'unit' | 'packSize' | 'status'>, product: Product | undefined, lk: CatalogLookups): boolean {
  if (!product || item.status === 'ignored' || !isPackUnit(item.unit)) return false;
  if (product.purchaseFactor > 1 || (item.packSize ?? 0) >= 1) return false;
  const stockUnit = normalize(lk.unit(product.unitId)).replace(/\./g, '');
  return !isPackUnit(stockUnit) && canonUnit(stockUnit) !== canonUnit(normalize(item.unit ?? '').replace(/\./g, ''));
}

/** Clave para recordar cómo figura un producto en las facturas ("COCA PET 2250" → "coca pet 2250"). */
export const aliasKey = (description: string) => tokens(description).join(' ');

/**
 * Decide el producto de cada renglón: primero lo que ya se confirmó antes para ese texto
 * (equivalencias aprendidas) o el código del proveedor; después la sugerencia de la IA; si no,
 * el nombre más parecido.
 */
export function matchLines(lines: AIReading['lines'], products: Product[], lk: CatalogLookups, byRef: Map<string, string>): InvoiceItem[] {
  const active = products.filter((p) => p.active);
  const byId = new Map(products.map((p) => [p.id, p]));
  const byCode = new Map<string, Product>();
  for (const p of active) for (const c of [p.sku, p.barcode]) if (c) byCode.set(normalize(c), p);
  const byAlias = new Map<string, Product>();
  for (const p of active) for (const a of p.invoiceAliases ?? []) byAlias.set(a, p);

  return lines.map((l) => {
    let product: Product | undefined;
    let status: InvoiceItem['status'] = 'none';
    const learned = byAlias.get(aliasKey(l.description));
    const coded = l.code ? byCode.get(normalize(l.code)) : undefined;
    const suggested = l.ref ? byId.get(byRef.get(l.ref) ?? '') : undefined;
    if (learned || coded) {
      product = learned ?? coded;
      status = 'ok';
    } else if (suggested?.active) {
      product = suggested;
      // Confianza alta de la IA y nombre razonablemente parecido: reconocido. Si no, a revisar.
      status = l.confidence === 'alta' && similarity(l.description, suggested.name) >= 0.35 ? 'ok' : 'check';
    } else {
      let best = 0;
      for (const p of active) {
        const s = similarity(l.description, p.name);
        if (s > best) { best = s; product = p; }
      }
      if (best >= 0.55) status = 'check';
      else product = undefined;
    }
    return {
      id: uuid(),
      description: l.description,
      code: l.code ?? undefined,
      quantity: round3(l.quantity),
      unit: l.unit ?? undefined,
      packSize: l.packSize ?? undefined,
      unitPrice: l.unitPrice ?? undefined,
      lineTotal: l.lineTotal ?? undefined,
      productId: product?.id,
      stockQty: product ? toStockQty(l.quantity, l.unit, product, lk, l.packSize) : undefined,
      status,
    };
  });
}

export const ITEM_STATUS_LABEL: Record<InvoiceItem['status'], string> = {
  ok: 'Reconocido',
  check: 'Revisar',
  none: 'Sin producto',
  ignored: 'No va al stock',
};

/** Renglones que faltan resolver antes de cargar al stock (producto sin confirmar o caja sin cantidad). */
export function pendingCount(items: InvoiceItem[] | undefined, products: Product[], lk: CatalogLookups): number {
  const byId = new Map(products.map((p) => [p.id, p]));
  return (items ?? []).filter((i) => i.status === 'check' || i.status === 'none' || (i.status === 'ok' && needsPackSize(i, byId.get(i.productId ?? ''), lk))).length;
}

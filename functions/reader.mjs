/**
 * Lectura de facturas con Claude: instrucciones, esquema de la respuesta y validación.
 * Sin dependencias de Firebase para poder probarlo aparte (tests/unit/invoice-ai.test.ts).
 */

export const MODEL = 'claude-sonnet-5-5';
export const MAX_IMAGES = 6;
export const MAX_IMAGE_B64 = 1_200_000; // ~900 KB por foto (la app las comprime a ≤ 650 KB)
export const MAX_CATALOG = 3000;

const str = { type: 'string' };
const nul = { type: 'null' };
const strOrNull = { anyOf: [str, nul] };
const numOrNull = { anyOf: [{ type: 'number' }, nul] };

/** Esquema JSON de la respuesta (structured outputs: additionalProperties false en todos los objetos). */
export const READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'invoice', 'lines', 'warnings'],
  properties: {
    supplier: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'cuit'],
      properties: { name: strOrNull, cuit: strOrNull },
    },
    invoice: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'number', 'date', 'total'],
      properties: {
        kind: { anyOf: [{ type: 'string', enum: ['factura', 'remito', 'ticket', 'nota_credito', 'otro'] }, nul] },
        number: strOrNull,
        date: { anyOf: [{ type: 'string', format: 'date' }, nul] },
        total: numOrNull,
      },
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'code', 'quantity', 'unit', 'packSize', 'unitPrice', 'lineTotal', 'ref', 'confidence'],
        properties: {
          description: str,
          code: strOrNull,
          quantity: { type: 'number' },
          unit: strOrNull,
          packSize: numOrNull,
          unitPrice: numOrNull,
          lineTotal: numOrNull,
          ref: strOrNull,
          confidence: { type: 'string', enum: ['alta', 'media', 'baja', 'ninguna'] },
        },
      },
    },
    warnings: { type: 'array', items: str },
  },
};

export const SYSTEM_PROMPT = `Leés fotos de facturas, remitos y tickets de proveedores de un negocio gastronómico de Argentina y devolvés sus renglones de productos para cargar el stock.

Reglas:
- Un renglón por cada producto comprado. No incluyas subtotales, IVA, percepciones, impuestos internos, fletes, totales ni datos de pago.
- Si hay un descuento o bonificación en un renglón, usá el precio final del renglón. Si hay un descuento general, anotalo en "warnings".
- Números con formato argentino: "1.234,56" es 1234.56. Las cantidades pueden tener decimales (kilos).
- "quantity" es la cantidad tal como figura en la factura, en la unidad de la factura ("unit": por ejemplo u, kg, l, caja, bulto, pack, docena, bolsa). No conviertas unidades.
- Muchas facturas escriben la cantidad con tres decimales: "1.000" o "2,000" en la columna de cantidad son 1 y 2 (no mil). Verificá con cantidad × precio unitario ≈ importe del renglón.
- Abreviaturas de unidad: "B", "BU", "BTO", "BULT" = bulto (poné unit "bulto"); "CJ", "CAJ" = caja; "UN", "U" = unidad; "KG", "K" = kg. Ejemplo: "1.000 B AMARGO OBRERO X 950 CC 2400" es quantity 1, unit "bulto".
- "packSize": cuántas unidades trae cada bulto o caja, sólo si figura en el renglón (ej. "X6", "X 12 U", "C/6", "PACK 6"). Ojo: "X 950 CC", "X 1 KG" o "X 2,25 L" es el tamaño de cada unidad, no la cantidad por caja. Si no figura, null.
- "description": el texto del producto como figura en la factura (corregí sólo cortes de línea evidentes).
- "code": el código del artículo del proveedor si aparece; si no, null.
- "ref": el número de referencia del producto del catálogo del negocio que corresponde a ese renglón, sólo si es el mismo producto (misma marca o tipo, y misma presentación o tamaño). Si dudás entre dos o no está, null. Nunca inventes una referencia que no esté en el catálogo.
- "confidence": qué tan seguro estás de "ref" (alta: mismo producto sin duda; media: muy probable; baja: parecido; ninguna: sin referencia).
- Si algo no se lee (borroso, cortado), no lo inventes: poné null donde se pueda y explicá en "warnings" qué no se leyó.
- "date" en formato AAAA-MM-DD. "number" con punto de venta y número (ej. "A 0003-00012345"). "total": el total final de la factura.
- Si la foto no es una factura, remito o ticket, devolvé "lines" vacío y explicalo en "warnings".
- Varias fotos son hojas de la misma factura: no repitas renglones.`;

/** Arma el pedido para la API de Claude. `catalog`: [{ref, name, unit, buy}] ya validado. */
export function buildRequest(images, catalog) {
  const catalogText = catalog
    .map((c) => `${c.ref}: ${c.name}${c.unit ? ` (${c.unit}${c.buy ? `; se compra en ${c.buy}` : ''})` : ''}`)
    .join('\n');
  return {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: READING_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } })),
          {
            type: 'text',
            text: `Catálogo de productos del negocio (referencia: nombre):\n${catalogText || '(vacío)'}\n\nLeé ${images.length === 1 ? 'la factura de la foto' : `la factura de estas ${images.length} fotos`} y devolvé los renglones.`,
          },
        ],
      },
    ],
  };
}

/** Forma de la respuesta, explicada en texto (Gemini la recibe así además de responseMimeType JSON). */
export const GEMINI_SHAPE = `Respondé SÓLO con un objeto JSON con esta forma exacta (usá null cuando no se lea un dato):
{"supplier":{"name":string|null,"cuit":string|null},
 "invoice":{"kind":"factura"|"remito"|"ticket"|"nota_credito"|"otro"|null,"number":string|null,"date":"AAAA-MM-DD"|null,"total":number|null},
 "lines":[{"description":string,"code":string|null,"quantity":number,"unit":string|null,"packSize":number|null,"unitPrice":number|null,"lineTotal":number|null,"ref":string|null,"confidence":"alta"|"media"|"baja"|"ninguna"}],
 "warnings":[string]}`;

/**
 * Pedido para Gemini (Google). Empieza con "systemInstruction" a propósito: el servidor de
 * Cloudflare verifica ese comienzo sin interpretar el resto (poco tiempo de CPU en el plan gratis).
 */
export function buildGeminiRequest(images, catalog) {
  const catalogText = catalog
    .map((c) => `${c.ref}: ${c.name}${c.unit ? ` (${c.unit}${c.buy ? `; se compra en ${c.buy}` : ''})` : ''}`)
    .join('\n');
  return {
    systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${GEMINI_SHAPE}` }] },
    contents: [
      {
        role: 'user',
        parts: [
          ...images.map((img) => ({ inlineData: { mimeType: img.type, data: img.data } })),
          { text: `Catálogo de productos del negocio (referencia: nombre):\n${catalogText || '(vacío)'}\n\nLeé ${images.length === 1 ? 'la factura de la foto' : `la factura de estas ${images.length} fotos`} y devolvé los renglones.` },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 16000 },
  };
}

/** Texto de la respuesta de Gemini + avisos según por qué terminó. Lanza error si fue bloqueada. */
export function geminiText(response) {
  const block = response?.promptFeedback?.blockReason;
  if (block) throw new Error('La IA no procesó estas fotos.');
  const cand = response?.candidates?.[0];
  if (!cand) throw new Error('La lectura no devolvió un resultado válido.');
  if (['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(cand.finishReason)) throw new Error('La IA no procesó estas fotos.');
  const text = (cand.content?.parts ?? []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  return { text, truncated: cand.finishReason === 'MAX_TOKENS' };
}

const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** Valida y limpia lo que manda la app (no se confía en el cliente). */
export function validateInput(data) {
  if (!data || typeof data !== 'object') throw new Error('Pedido vacío.');
  const wsId = cut(data.wsId, 128);
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(wsId)) throw new Error('Espacio inválido.');
  const images = Array.isArray(data.images) ? data.images : [];
  if (!images.length) throw new Error('Falta la foto.');
  if (images.length > MAX_IMAGES) throw new Error(`Máximo ${MAX_IMAGES} fotos por lectura.`);
  const cleanImages = images.map((img) => {
    const type = ['image/jpeg', 'image/png', 'image/webp'].includes(img?.type) ? img.type : null;
    const b64 = typeof img?.data === 'string' ? img.data : '';
    if (!type || !b64 || b64.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(b64.slice(0, 200))) throw new Error('Foto inválida o demasiado grande.');
    return { type, data: b64 };
  });
  const catalog = (Array.isArray(data.catalog) ? data.catalog : []).slice(0, MAX_CATALOG).map((c) => ({
    ref: cut(String(c?.ref ?? ''), 12),
    name: cut(c?.name, 90).replace(/\s+/g, ' '),
    unit: cut(c?.unit, 20),
    buy: cut(c?.buy, 30),
  })).filter((c) => c.ref && c.name);
  return { wsId, images: cleanImages, catalog };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/** Valida la respuesta del modelo: descarta referencias inexistentes y renglones sin cantidad. */
export function parseReading(text, refs) {
  let raw;
  try {
    // Algunos modelos envuelven el JSON en ```json … ```: se toma el objeto de adentro.
    const t = String(text ?? '').trim();
    const body = t.startsWith('{') ? t : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
    raw = JSON.parse(body);
  } catch {
    throw new Error('La lectura no devolvió un resultado válido.');
  }
  const known = new Set(refs);
  const lines = (Array.isArray(raw?.lines) ? raw.lines : [])
    .map((l) => {
      const ref = s(l?.ref, 12);
      const ok = ref && known.has(ref);
      return {
        description: s(l?.description) ?? '(sin descripción)',
        code: s(l?.code, 40),
        quantity: num(l?.quantity) ?? 0,
        unit: s(l?.unit, 20),
        packSize: num(l?.packSize) && l.packSize > 1 && l.packSize <= 1000 ? Math.round(l.packSize) : null,
        unitPrice: num(l?.unitPrice),
        lineTotal: num(l?.lineTotal),
        ref: ok ? ref : null,
        confidence: ok && ['alta', 'media', 'baja'].includes(l?.confidence) ? l.confidence : 'ninguna',
      };
    })
    .filter((l) => l.quantity > 0);
  const date = s(raw?.invoice?.date, 10);
  return {
    supplier: { name: s(raw?.supplier?.name, 120), cuit: s(raw?.supplier?.cuit, 20) },
    invoice: {
      kind: s(raw?.invoice?.kind, 20),
      number: s(raw?.invoice?.number, 40),
      date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      total: num(raw?.invoice?.total),
    },
    lines,
    warnings: (Array.isArray(raw?.warnings) ? raw.warnings : []).map((w) => s(w, 300)).filter(Boolean).slice(0, 10),
  };
}

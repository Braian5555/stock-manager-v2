/**
 * Códigos de barra: validación (EAN-13, EAN-8, UPC-A, Code 128), equivalencias para
 * buscar, código interno y dibujo Code 128 para imprimir etiquetas.
 */

export type BarcodeFormat = 'EAN-13' | 'EAN-8' | 'UPC-A' | 'CODE-128';

export interface BarcodeCheck {
  ok: boolean;
  code: string;
  format?: BarcodeFormat;
  /** Motivo por el que no se acepta. */
  error?: string;
  /** Se acepta, pero conviene revisarlo (p. ej. dígito verificador que no coincide). */
  warning?: string;
}

export const MAX_BARCODE_LENGTH = 48;

/** Limpia lo que devuelve un lector o lo que se tipeó: espacios, saltos y caracteres de control. */
export function normalizeBarcode(raw: string): string {
  // eslint-disable-next-line no-control-regex -- se quitan justamente los caracteres de control
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, '').trim();
}

/** Dígito verificador GS1 (EAN-13, EAN-8, UPC-A) para los dígitos sin el verificador. */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

function gs1Valid(code: string): boolean {
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

export function validateBarcode(raw: string): BarcodeCheck {
  const code = normalizeBarcode(raw);
  if (!code) return { ok: false, code, error: 'Ingresá un código.' };
  if (code.length > MAX_BARCODE_LENGTH) return { ok: false, code, error: `El código es demasiado largo (máximo ${MAX_BARCODE_LENGTH} caracteres).` };
  if (!/^[\x20-\x7e]+$/.test(code)) return { ok: false, code, error: 'El código tiene caracteres que no se pueden imprimir en una etiqueta (usá letras sin tilde, números y signos comunes).' };
  if (/^\d+$/.test(code) && [8, 12, 13].includes(code.length)) {
    const format: BarcodeFormat = code.length === 13 ? 'EAN-13' : code.length === 12 ? 'UPC-A' : 'EAN-8';
    if (gs1Valid(code)) return { ok: true, code, format };
    return { ok: true, code, format: 'CODE-128', warning: `Parece un ${format} pero el último dígito no coincide. Revisá que esté bien escrito.` };
  }
  return { ok: true, code, format: 'CODE-128' };
}

/**
 * Formas equivalentes de un mismo código para buscar: un UPC-A (12 dígitos) es el
 * mismo producto que el EAN-13 con un 0 adelante, y algunos lectores devuelven uno u otro.
 */
export function barcodeKeys(raw: string): string[] {
  const code = normalizeBarcode(raw);
  if (!code) return [];
  const keys = new Set([code.toUpperCase()]);
  if (/^\d{12}$/.test(code)) keys.add(`0${code}`);
  if (/^0\d{12}$/.test(code)) keys.add(code.slice(1));
  return [...keys];
}

export function sameBarcode(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const kb = new Set(barcodeKeys(b));
  return barcodeKeys(a).some((k) => kb.has(k));
}

/** Prefijo de los códigos internos generados por la app (etiquetas propias). */
export const INTERNAL_PREFIX = 'SM';

/** Siguiente código interno libre: SM000001, SM000002… */
export function nextInternalCode(existing: Iterable<string | undefined>): string {
  let max = 0;
  const re = new RegExp(`^${INTERNAL_PREFIX}(\\d{6,})$`);
  for (const c of existing) {
    const m = c && re.exec(c.toUpperCase());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${INTERNAL_PREFIX}${String(max + 1).padStart(6, '0')}`;
}

// ── Code 128 (juego B) ───────────────────────────────────────────────────────
// Anchos de barra/espacio de cada símbolo (6 elementos, 11 módulos); 106 = stop (7 elementos).
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const CODE128_PATTERNS: readonly string[] = CODE128;
const START_B = 104;
const STOP = 106;

/** Símbolos Code 128 (juego B) con verificador, inicio y fin. */
export function code128Symbols(text: string): number[] {
  if (!/^[\x20-\x7e]+$/.test(text)) throw new Error('Code 128 sólo admite caracteres ASCII imprimibles.');
  const data = [...text].map((ch) => ch.charCodeAt(0) - 32);
  const check = (START_B + data.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  return [START_B, ...data, check, STOP];
}

/** Anchos alternados barra/espacio (empieza con barra), en módulos. */
export function code128Widths(text: string): number[] {
  return code128Symbols(text).flatMap((s) => [...CODE128[s]].map(Number));
}

/** SVG del código de barras (sin texto), escalable. `quiet` = margen en módulos a cada lado. */
export function code128Svg(text: string, opts: { height?: number; quiet?: number } = {}): string {
  const widths = code128Widths(text);
  const quiet = opts.quiet ?? 10;
  const height = opts.height ?? 50;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const rects: string[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Código ${escapeXml(text)}"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

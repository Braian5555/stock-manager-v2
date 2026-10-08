const numberFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
const dateFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' });

export const fmtNumber = (n: number | undefined | null): string => (n == null || Number.isNaN(n) ? '—' : numberFmt.format(n));
export const fmtDate = (iso?: string): string => (iso ? dateFmt.format(new Date(iso)) : '—');
export const fmtTime = (iso?: string): string => (iso ? timeFmt.format(new Date(iso)) : '');
export const fmtDateTime = (iso?: string): string => (iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '—');
export const fmtSigned = (n: number): string => (n > 0 ? `+${fmtNumber(n)}` : fmtNumber(n));

/** Normaliza texto para búsquedas: minúsculas y sin acentos. */
export const normalize = (s: string | undefined | null): string =>
  (s ?? '').toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export const matches = (query: string, ...fields: (string | undefined)[]): boolean => {
  const q = normalize(query);
  if (!q) return true;
  return fields.some((f) => normalize(f).includes(q));
};

/**
 * Convierte texto a número aceptando formato argentino y anglosajón:
 * "1,5" → 1.5 · "1.234,5" → 1234.5 · "1.500" → 1500 · "1,234.5" → 1234.5 · "2.5" → 2.5
 */
export function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  let s = value.trim().replace(/\s|\$/g, '');
  if (!s) return fallback;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Ambos separadores: el último es el decimal.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /^-?[1-9]\d{0,2}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.500" o "12.345.678": puntos de miles
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const moneyFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtMoney = (n: number | undefined | null): string => (n == null || Number.isNaN(n) ? '—' : moneyFmt.format(n));
/** "2026-10-07" → "07/10/2026" sin problemas de zona horaria. */
export const fmtDay = (ymd?: string): string => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '—');

/** Fecha local (no UTC) en formato YYYY-MM-DD. En Argentina, después de las 21 h el UTC ya es "mañana". */
export function localYmd(d: Date | string = new Date()): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

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

/** Convierte strings con coma decimal ("1,5") o vacíos a número. */
export function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const s = value.trim();
  if (!s) return fallback;
  const cleaned = s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const moneyFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtMoney = (n: number | undefined | null): string => (n == null || Number.isNaN(n) ? '—' : moneyFmt.format(n));
/** "2026-10-07" → "07/10/2026" sin problemas de zona horaria. */
export const fmtDay = (ymd?: string): string => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '—');

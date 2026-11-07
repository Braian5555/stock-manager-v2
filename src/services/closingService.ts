/**
 * Cierre del día ("Z") y libro IVA ventas para el contador. Cálculo puro (sin base de datos).
 *
 * - Cierre del día: lo vendido ese día (pedidos cerrados) por medio de pago y canal, descuentos,
 *   propinas, cortesías, anulados y lo facturado en ARCA por tipo de comprobante (con primer y
 *   último número), separando lo que se cobró sin factura.
 * - Libro IVA ventas: los comprobantes AUTORIZADOS del mes (por fecha del comprobante), con neto
 *   e IVA por alícuota. Las notas de crédito van en negativo. Los de homologación no cuentan.
 */
import type { FiscalDoc, TableTicket } from '../models';
import { CBTE_NAME, COND_IVA, DOC_TIPO_LABEL, docNumber } from './fiscalService';
import { salesReport, type Bucket, type SalesReport } from './salesReportService';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Fecha AAAAMMDD de ARCA → AAAA-MM-DD. */
const isoDate = (f?: string) => (f && f.length === 8 ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : '');
const sign = (d: Pick<FiscalDoc, 'kind'>) => (d.kind === 'nc' ? -1 : 1);
/** Comprobantes que valen para el libro: autorizados, en producción (salvo que se pidan los de prueba). */
const counts = (d: FiscalDoc, withTest: boolean) => d.status === 'autorizada' && !!d.nro && (withTest || d.ambiente === 'produccion');

export interface FiscalByType { cbteTipo: number; name: string; count: number; first?: number; last?: number; neto: number; iva: number; total: number }

function byType(docs: FiscalDoc[]): FiscalByType[] {
  const m = new Map<number, FiscalByType>();
  for (const d of docs) {
    const s = sign(d);
    const r = m.get(d.cbteTipo) ?? { cbteTipo: d.cbteTipo, name: CBTE_NAME[d.cbteTipo] ?? `Tipo ${d.cbteTipo}`, count: 0, neto: 0, iva: 0, total: 0 };
    r.count++;
    r.first = r.first === undefined ? d.nro : Math.min(r.first, d.nro!);
    r.last = r.last === undefined ? d.nro : Math.max(r.last, d.nro!);
    r.neto = round2(r.neto + s * (d.impNeto + d.impTotConc + d.impOpEx));
    r.iva = round2(r.iva + s * d.impIva);
    r.total = round2(r.total + s * d.impTotal);
    m.set(d.cbteTipo, r);
  }
  return [...m.values()].sort((a, b) => a.cbteTipo - b.cbteTipo);
}

// ───────────────────────── Cierre del día ─────────────────────────

export interface DailyClose {
  date: string;
  sales: SalesReport;
  fiscal: FiscalByType[];
  /** Total facturado en ARCA (neto de notas de crédito). */
  invoiced: number;
  /** Cobros de ese día que quedaron sin factura electrónica. */
  unbilled: number;
  test: boolean;
}

export function dailyClose(date: string, tickets: TableTicket[], docs: FiscalDoc[], ctx: Parameters<typeof salesReport>[2]): DailyClose {
  const sales = salesReport(tickets, { from: date, to: date }, ctx);
  const day = docs.filter((d) => d.status === 'autorizada' && !!d.nro && isoDate(d.fecha) === date);
  const real = day.filter((d) => d.ambiente === 'produccion');
  const used = real.length ? real : day;
  const fiscal = byType(used);
  const invoiced = round2(fiscal.reduce((s, r) => s + r.total, 0));
  // Cobros de ese día sin factura autorizada (facturación apagada, o pendiente de resolver).
  const authorized = new Set(docs.filter((d) => d.status === 'autorizada').map((d) => d.id));
  let unbilled = 0;
  for (const t of tickets) {
    if (t.status !== 'cerrada' || !t.closedAt) continue;
    if (t.charges?.length) {
      // Las invitaciones no se facturan: no cuentan como "sin factura".
      for (const c of t.charges) if (localDay(c.at) === date && !(c.fiscalDocId && authorized.has(c.fiscalDocId))) unbilled += c.amount - c.payments.filter((p) => p.method === 'invitacion').reduce((a, p) => a + p.amount, 0);
    } else if (localDay(t.closedAt) === date && !(t.fiscalDocId && authorized.has(t.fiscalDocId))) unbilled += t.total;
  }
  return { date, sales, fiscal, invoiced, unbilled: round2(unbilled), test: !real.length && day.length > 0 };
}

const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ───────────────────────── Libro IVA ventas ─────────────────────────

export interface IvaBook {
  month: string;
  rates: number[];
  rows: (string | number)[][];
  columns: string[];
  byType: FiscalByType[];
  totals: { neto: number; iva: number; noGravado: number; exento: number; total: number; byRate: Map<number, { base: number; iva: number }> };
  count: number;
}

const rateLabel = (r: number) => String(r).replace('.', ',');

export function ivaBook(docs: FiscalDoc[], month: string, withTest = false): IvaBook {
  const list = docs.filter((d) => counts(d, withTest) && isoDate(d.fecha).startsWith(month))
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '') || a.cbteTipo - b.cbteTipo || (a.nro ?? 0) - (b.nro ?? 0));
  const rates = [...new Set(list.flatMap((d) => d.iva.map((i) => Number(i.rate))))].sort((a, b) => b - a);
  const byRate = new Map<number, { base: number; iva: number }>(rates.map((r) => [r, { base: 0, iva: 0 }]));
  const totals = { neto: 0, iva: 0, noGravado: 0, exento: 0, total: 0, byRate };
  const columns = ['Fecha', 'Comprobante', 'Punto de venta', 'Número', 'Tipo doc.', 'Nro. doc.', 'Cliente', 'Condición IVA',
    ...rates.flatMap((r) => [`Neto ${rateLabel(r)}%`, `IVA ${rateLabel(r)}%`]), 'No gravado', 'Exento', 'Total', 'CAE'];
  const rows = list.map((d) => {
    const s = sign(d);
    const perRate = rates.flatMap((r) => {
      const x = d.iva.filter((i) => Number(i.rate) === r);
      const base = round2(s * x.reduce((a, i) => a + i.baseImp, 0));
      const iva = round2(s * x.reduce((a, i) => a + i.importe, 0));
      const t = byRate.get(r)!;
      t.base = round2(t.base + base);
      t.iva = round2(t.iva + iva);
      return [base, iva];
    });
    totals.neto = round2(totals.neto + s * d.impNeto);
    totals.iva = round2(totals.iva + s * d.impIva);
    totals.noGravado = round2(totals.noGravado + s * d.impTotConc);
    totals.exento = round2(totals.exento + s * d.impOpEx);
    totals.total = round2(totals.total + s * d.impTotal);
    const [y, m, dd] = isoDate(d.fecha).split('-');
    return [`${dd}/${m}/${y}`, CBTE_NAME[d.cbteTipo] ?? String(d.cbteTipo), d.ptoVta, docNumber(d), DOC_TIPO_LABEL[d.receptor.docTipo] ?? '', d.receptor.docTipo === 99 ? '' : d.receptor.docNro,
      d.receptor.docTipo === 99 ? 'Consumidor final' : d.receptor.nombre ?? '', COND_IVA[d.receptor.condicionIva] ?? '',
      ...perRate, round2(s * d.impTotConc), round2(s * d.impOpEx), round2(s * d.impTotal), d.cae ?? ''];
  });
  if (rows.length) {
    rows.push(['TOTAL', '', '', '', '', '', '', '', ...rates.flatMap((r) => [byRate.get(r)!.base, byRate.get(r)!.iva]), totals.noGravado, totals.exento, totals.total, '']);
  }
  return { month, rates, rows, columns, byType: byType(list), totals, count: list.length };
}

export type { Bucket };

import { useLiveQuery } from 'dexie-react-hooks';
import { FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db } from '../../database/db';
import { EMPTY, useProducts } from '../../hooks/useData';
import { useCosts } from '../../hooks/useCosts';
import type { TableTicket } from '../../models';
import { fiscalOf } from '../../services/fiscalService';
import { periodRange, salesReport, type Bucket, type QuickPeriod, type SalesReport } from '../../services/salesReportService';
import { useFeedback } from '../../store/feedback';
import { useSettings } from '../../store/settings';
import { fmtMoney } from '../../utils/format';
import { EmptyState, Field, Input, Segmented } from '../ui';
import { useMenu } from './hooks';
import { inLocal, useLocalScope } from '../../services/localScope';

type Period = QuickPeriod | 'rango';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'hoy', label: 'Hoy' }, { value: 'ayer', label: 'Ayer' }, { value: '7d', label: '7 días' },
  { value: 'mes', label: 'Este mes' }, { value: 'mesAnterior', label: 'Mes anterior' }, { value: 'rango', label: 'Elegir fechas' },
];
const pct = (n?: number) => (n === undefined ? '—' : `${String(n).replace('.', ',')}%`);
const dayLabel = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}/${m}${y === String(new Date().getFullYear()) ? '' : `/${y}`}`; };

/** Reportes de ventas del salón (período, platos, costo y margen, días, horas, pagos, canales y mozos). */
export function SalesReports() {
  const settings = useSettings();
  const fiscal = fiscalOf(settings);
  const { run, notify } = useFeedback();
  const [period, setPeriod] = useState<Period>('hoy');
  const [custom, setCustom] = useState(() => periodRange('7d'));
  const range = period === 'rango' ? custom : periodRange(period);
  // Un día antes por si un pedido abierto antes de medianoche se cerró dentro del período.
  const since = useMemo(() => { const d = new Date(`${range.from}T00:00:00`); d.setDate(d.getDate() - 1); return d.toISOString(); }, [range.from]);
  const lid = useLocalScope().current?.id;
  const tickets = (useLiveQuery(() => db.tickets.where('openedAt').aboveOrEqual(since).filter(inLocal).toArray(), [since, lid]) ?? EMPTY) as TableTicket[];
  const menu = useMenu();
  const products = useProducts();
  const costs = useCosts();
  const [allItems, setAllItems] = useState(false);

  const report = useMemo(() => salesReport(tickets, range, {
    menu: new Map(menu.map((m) => [m.id, m])),
    costOf: costs.visible ? costs.costOf : undefined,
    products: new Map(products.map((p) => [p.id, p])),
    fiscal,
  }), [tickets, range.from, range.to, menu, products, costs, fiscal.enabled, fiscal.condicionIva, fiscal.ivaDefault]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportXlsx = () => void run(async () => {
    const [{ toXlsx }, { downloadBlob }] = await Promise.all([import('../../exports/writers'), import('../../exports/download')]);
    const blob = await toXlsx(`Ventas del salón ${range.from} a ${range.to}`, reportDatasets(report, costs.visible));
    downloadBlob(blob, `ventas-salon_${range.from}_${range.to}.xlsx`);
    notify('Excel de ventas descargado');
  });

  const items = allItems ? report.items : report.items.slice(0, 12);
  const multiDay = range.from !== range.to;
  return (
    <>
      <div className="sales-period">
        <Segmented<Period> label="Período" value={period} onChange={setPeriod} options={PERIODS} />
        {period === 'rango' && (
          <>
            <Field label="Desde"><Input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></Field>
            <Field label="Hasta"><Input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></Field>
          </>
        )}
        <button type="button" className="btn" onClick={exportXlsx} disabled={!report.orders}><FileSpreadsheet size={18} aria-hidden /> Excel</button>
      </div>

      <div className="salon-stats" aria-label="Resumen del período">
        <div className="salon-stat"><span className="num">{fmtMoney(report.sold)}</span><span>vendido</span></div>
        <div className="salon-stat"><span className="num">{report.orders}</span><span>{report.orders === 1 ? 'pedido' : 'pedidos'}</span></div>
        <div className="salon-stat"><span className="num">{report.orders ? fmtMoney(report.avg) : '—'}</span><span>ticket promedio</span></div>
        <div className="salon-stat"><span className="num">{report.guests || '—'}</span><span>comensales</span></div>
        {costs.visible && <div className="salon-stat"><span className="num">{report.cost ? fmtMoney(report.cost) : '—'}</span><span>costo de lo vendido</span></div>}
        {costs.visible && <div className="salon-stat"><span className="num">{pct(report.foodCostPct)}</span><span>costo sobre ventas</span></div>}
      </div>
      <p className="small muted">
        Descuentos {fmtMoney(report.discounts)} · cortesías {fmtMoney(report.compValue)} · propinas {fmtMoney(report.tips)}{report.cancelled ? ` · ${report.cancelled} anulado${report.cancelled === 1 ? '' : 's'}` : ''}
        {costs.visible && report.orders > 0 && report.costCoverage < 100 && ` · el costo cubre el ${report.costCoverage}% de lo vendido (faltan recetas o costos de insumos)`}
      </p>

      {report.orders === 0 ? (
        <div className="card"><EmptyState title="Sin ventas en este período">Cuando se cierren pedidos en estas fechas, aparecen acá.</EmptyState></div>
      ) : (
        <>
          <section className="card" aria-labelledby="sales-items">
            <div className="card-head"><h2 id="sales-items">Por plato</h2><span className="small muted">antes de descuentos</span></div>
            <div className="table-wrap">
              <table className="table sales-table">
                <thead><tr><th>Plato</th><th className="num">Cant.</th><th className="num">Vendido</th>{costs.visible && <><th className="num">Costo</th><th className="num">Margen</th><th className="num">Costo %</th></>}</tr></thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.key}>
                      <td>{r.name}{r.comp ? <span className="small muted"> · {r.comp} cortesía{r.comp === 1 ? '' : 's'}</span> : null}</td>
                      <td className="num">{r.qty}</td>
                      <td className="num">{fmtMoney(r.revenue)}</td>
                      {costs.visible && <><td className="num">{r.cost !== undefined ? fmtMoney(r.cost) : '—'}</td><td className="num">{r.margin !== undefined ? fmtMoney(r.margin) : '—'}</td><td className="num">{pct(r.pct)}</td></>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.items.length > 12 && <div className="card-pad" style={{ paddingTop: 8 }}><button type="button" className="btn btn-sm" onClick={() => setAllItems(!allItems)}>{allItems ? 'Ver menos' : `Ver los ${report.items.length}`}</button></div>}
          </section>

          <div className="sales-grid">
            {multiDay && <Bars id="sales-days" title="Por día" rows={report.byDay.map((b) => ({ ...b, label: dayLabel(b.key) }))} sub={(b) => `${b.count} pedido${b.count === 1 ? '' : 's'}`} keepOrder />}
            <Hours rows={report.byHour} />
            <Bars id="sales-pay" title="Medios de pago" rows={report.byPayment} />
            <Bars id="sales-channel" title="Por canal" rows={report.byChannel} sub={(b) => `${b.count} pedido${b.count === 1 ? '' : 's'}`} />
            <Bars id="sales-waiter" title="Por mozo / cajero" rows={report.byWaiter} sub={(b) => `${b.count} pedido${b.count === 1 ? '' : 's'} · promedio ${fmtMoney(b.total / b.count)}`} />
            <Bars id="sales-section" title="Por sección de la carta" rows={report.bySection} sub={(b) => `${b.count} unidades`} />
          </div>
        </>
      )}
    </>
  );
}

export function Bars({ id, title, rows, sub, keepOrder }: { id: string; title: string; rows: Bucket[]; sub?: (b: Bucket) => string; keepOrder?: boolean }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.total), 1);
  const list = keepOrder ? rows : rows.slice(0, 10);
  return (
    <section className="card" aria-labelledby={id}>
      <div className="card-head"><h2 id={id}>{title}</h2></div>
      <ul className="sales-bars">
        {list.map((r) => (
          <li key={r.key}>
            <span className="truncate">{r.label}</span>
            <b className="num">{fmtMoney(r.total)}</b>
            <span className="bar" style={{ width: `${(r.total / max) * 100}%` }} aria-hidden />
            {sub && <span className="sub">{sub(r)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Hours({ rows }: { rows: Bucket[] }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.total), 1);
  const first = Number(rows[0].key), last = Number(rows[rows.length - 1].key);
  const all = Array.from({ length: last - first + 1 }, (_, i) => rows.find((r) => Number(r.key) === first + i) ?? { key: String(first + i), label: `${first + i} h`, count: 0, total: 0 });
  return (
    <section className="card" aria-labelledby="sales-hours">
      <div className="card-head"><h2 id="sales-hours">Por hora</h2><span className="small muted">según la hora en que se abrió el pedido</span></div>
      <div className="sales-hours" role="list">
        {all.map((r) => (
          <div key={r.key} className="sales-hour" role="listitem" aria-label={`${Number(r.key)} h: ${fmtMoney(r.total)}, ${r.count} pedidos`} title={`${fmtMoney(r.total)} · ${r.count} pedidos`}>
            <span className="col" style={{ height: `${Math.max(2, (r.total / max) * 90)}px` }} aria-hidden />
            <span>{Number(r.key)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function reportDatasets(r: SalesReport, withCost: boolean) {
  const b = (title: string, rows: Bucket[], countLabel = 'Pedidos') => ({ title, columns: [title.replace('Por ', ''), countLabel, 'Total'], rows: rows.map((x) => [x.label, x.count, x.total]) });
  return [
    { title: 'Resumen', columns: ['Concepto', 'Valor'], rows: [
      ['Desde', r.from], ['Hasta', r.to], ['Vendido', r.sold], ['Pedidos', r.orders], ['Ticket promedio', r.avg], ['Comensales', r.guests],
      ['Descuentos', r.discounts], ['Cortesías', r.compValue], ['Propinas', r.tips], ['Pedidos anulados', r.cancelled],
      ...(withCost ? [['Costo de lo vendido', r.cost], ['Costo sobre ventas (%)', r.foodCostPct ?? ''], ['Ventas con costo conocido (%)', r.costCoverage]] : []),
    ] },
    { title: 'Por plato', columns: ['Plato', 'Sección', 'Cantidad', 'Cortesías', 'Vendido', ...(withCost ? ['Costo', 'Margen', 'Costo %'] : [])],
      rows: r.items.map((x) => [x.name, x.section, x.qty, x.comp, x.revenue, ...(withCost ? [x.cost ?? '', x.margin ?? '', x.pct ?? ''] : [])]) },
    b('Por día', r.byDay), b('Por hora', r.byHour), b('Medios de pago', r.byPayment, 'Pagos'), b('Por canal', r.byChannel), b('Por mozo', r.byWaiter), b('Por sección', r.bySection, 'Unidades'),
  ];
}

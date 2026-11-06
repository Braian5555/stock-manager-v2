import { useLiveQuery } from 'dexie-react-hooks';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db } from '../../database/db';
import { EMPTY, useProducts } from '../../hooks/useData';
import { useCosts } from '../../hooks/useCosts';
import type { FiscalDoc, TableTicket } from '../../models';
import { dailyClose } from '../../services/closingService';
import { fiscalOf, PAYMENT_LABEL } from '../../services/fiscalService';
import { cierreHtml, printHtml } from '../../services/printService';
import { useFeedback } from '../../store/feedback';
import { useSettings } from '../../store/settings';
import { fmtMoney } from '../../utils/format';
import { Field, Input } from '../ui';
import { Modal } from '../ui/Modal';
import { useMenu } from './hooks';

const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Cierre del día ("Z"): resumen para imprimir o bajar a Excel, de hoy o de otro día. */
export function DayCloseModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const fiscal = fiscalOf(settings);
  const { run, notify } = useFeedback();
  const [date, setDate] = useState(ymd());
  const since = useMemo(() => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() - 1); return d.toISOString(); }, [date]);
  const tickets = (useLiveQuery(() => db.tickets.where('openedAt').aboveOrEqual(since).toArray(), [since]) ?? EMPTY) as TableTicket[];
  const docs = (useLiveQuery(() => db.fiscalDocs.where('createdAt').aboveOrEqual(since).toArray(), [since]) ?? EMPTY) as FiscalDoc[];
  const menu = useMenu();
  const products = useProducts();
  const costs = useCosts();
  const z = useMemo(() => dailyClose(date, tickets, docs, {
    menu: new Map(menu.map((m) => [m.id, m])), costOf: costs.visible ? costs.costOf : undefined,
    products: new Map(products.map((p) => [p.id, p])), fiscal, payLabel: PAYMENT_LABEL,
  }), [date, tickets, docs, menu, products, costs, fiscal]);
  const s = z.sales;

  const excel = () => void run(async () => {
    const [{ toXlsx }, { downloadBlob }] = await Promise.all([import('../../exports/writers'), import('../../exports/download')]);
    const blob = await toXlsx(`Cierre del día ${date}`, [
      { title: 'Cierre', columns: ['Concepto', 'Importe'], rows: [
        ['Vendido', s.sold], ['Pedidos', s.orders], ['Ticket promedio', s.avg], ['Comensales', s.guests], ['Descuentos', s.discounts],
        ['Cortesías', s.compValue], ['Propinas', s.tips], ['Pedidos anulados', s.cancelled], ['Total facturado (ARCA)', z.invoiced], ['Cobrado sin factura', z.unbilled],
      ] },
      { title: 'Medios de pago', columns: ['Medio', 'Pagos', 'Importe'], rows: s.byPayment.map((b) => [b.label, b.count, b.total]) },
      { title: 'Canales', columns: ['Canal', 'Pedidos', 'Importe'], rows: s.byChannel.map((b) => [b.label, b.count, b.total]) },
      { title: 'Facturación', columns: ['Comprobante', 'Cantidad', 'Desde', 'Hasta', 'Neto', 'IVA', 'Total'], rows: z.fiscal.map((f) => [f.name, f.count, f.first ?? '', f.last ?? '', f.neto, f.iva, f.total]) },
      { title: 'Platos', columns: ['Plato', 'Cantidad', 'Vendido'], rows: s.items.map((i) => [i.name, i.qty, i.revenue]) },
    ]);
    downloadBlob(blob, `cierre_${date}.xlsx`);
    notify('Excel del cierre descargado');
  });

  return (
    <Modal open title="Cierre del día" onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={excel}><FileSpreadsheet size={18} aria-hidden /> Excel</button>
        <button type="button" className="btn btn-primary" onClick={() => void run(() => printHtml(cierreHtml(z, settings.businessName)))}><Printer size={18} aria-hidden /> Imprimir cierre</button>
      </>}>
      <div className="stack">
        <Field label="Día"><Input type="date" value={date} max={ymd()} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        <table className="table sales-table" aria-label="Resumen del cierre">
          <tbody>
            <tr><th scope="row">Vendido</th><td className="num"><b>{fmtMoney(s.sold)}</b></td></tr>
            <tr><th scope="row">Pedidos</th><td className="num">{s.orders}{s.cancelled ? ` (+${s.cancelled} anulado${s.cancelled === 1 ? '' : 's'})` : ''}</td></tr>
            {s.byPayment.map((b) => <tr key={b.key}><th scope="row" className="muted">{b.label}</th><td className="num">{fmtMoney(b.total)}</td></tr>)}
            <tr><th scope="row">Descuentos · cortesías · propinas</th><td className="num">{fmtMoney(s.discounts)} · {fmtMoney(s.compValue)} · {fmtMoney(s.tips)}</td></tr>
            <tr><th scope="row">Facturado en ARCA{z.test ? ' (prueba)' : ''}</th><td className="num">{fmtMoney(z.invoiced)}</td></tr>
            {z.fiscal.map((f) => <tr key={f.cbteTipo}><th scope="row" className="muted">{f.name} ({f.count})</th><td className="num">{fmtMoney(f.total)}</td></tr>)}
            <tr><th scope="row">Cobrado sin factura</th><td className="num">{fmtMoney(z.unbilled)}</td></tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

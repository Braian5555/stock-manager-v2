import { Receipt } from 'lucide-react';
import type { Invoice } from '../../models';
import { useLookups } from '../../hooks/useData';
import { fmtDay, fmtMoney, localYmd } from '../../utils/format';
import { paymentDueDate, paymentText } from '../../services/invoiceService';

export function InvoiceList({ invoices, onOpen }: { invoices: Invoice[]; onOpen: (i: Invoice) => void }) {
  const lk = useLookups();
  return (
    <div className="list">
      {invoices.map((i) => {
        const thumb = i.pages[0]?.thumb;
        const sup = lk.supplier(i.supplierId) || 'Sin proveedor';
        return (
          <button key={i.id} type="button" className="list-item invoice-item" onClick={() => onOpen(i)} aria-label={`Factura ${i.number ?? ''} de ${sup}, ${fmtDay(i.date)}`}>
            {thumb ? <img className="invoice-thumb" src={thumb} alt="" /> : <span className="invoice-thumb stat-icon" aria-hidden><Receipt size={18} /></span>}
            <div className="grow">
              <div className="list-title truncate">{sup}{i.number ? ` · ${i.number}` : ''}</div>
              <div className="list-sub">
                {fmtDay(i.date)} · {i.pages.length} {i.pages.length === 1 ? 'foto' : 'fotos'}
                {i.stockAppliedAt ? <> · <span className="badge badge-ok">En stock</span></> : i.items?.length ? <> · <span className="badge">Sin cargar</span></> : null}
                <PaymentBadge invoice={i} />
              </div>
            </div>
            {i.total !== undefined && <span className="num invoice-total">{fmtMoney(i.total)}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** "Pagada" o "A pagar · eCheq 30 días (vence 18/11)". */
function PaymentBadge({ invoice }: { invoice: Invoice }) {
  const p = invoice.payment;
  if (!p?.method && !p?.paid) return null;
  const how = paymentText(p);
  if (p.paid) return <> · <span className="badge badge-ok">Pagada{how ? ` · ${how}` : ''}</span></>;
  const due = paymentDueDate(invoice);
  const late = !!due && due < localYmd();
  return <> · <span className={`badge ${late ? 'badge-error' : 'badge-warn'}`}>A pagar{how ? ` · ${how}` : ''}{due ? ` (${late ? 'venció' : 'se cobra'} ${fmtDay(due)})` : ''}</span></>;
}

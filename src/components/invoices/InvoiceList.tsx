import { Receipt } from 'lucide-react';
import type { Invoice } from '../../models';
import { useLookups } from '../../hooks/useData';
import { fmtDay, fmtMoney } from '../../utils/format';

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
              <div className="list-sub">{fmtDay(i.date)} · {i.pages.length} {i.pages.length === 1 ? 'foto' : 'fotos'}</div>
            </div>
            {i.total !== undefined && <span className="num invoice-total">{fmtMoney(i.total)}</span>}
          </button>
        );
      })}
    </div>
  );
}

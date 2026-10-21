import { Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Invoice, PaymentMethod } from '../../models';
import { PAYMENT_LABEL, paymentDueDate, setInvoicePayment } from '../../services/invoiceService';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { fmtDay, localYmd } from '../../utils/format';
import { NumberInput, Segmented } from '../ui';

const DAY_CHOICES = [0, 15, 30, 45, 60, 90];

/** Cómo se paga la factura (eCheq a N días, efectivo o transferencia) y si ya se pagó. Se guarda al tocar. */
export function InvoicePaymentPanel({ invoice }: { invoice: Invoice }) {
  const { can } = useSession();
  const { run } = useFeedback();
  const editable = can('invoices') || can('admin');
  const p = invoice.payment;
  const [otherDays, setOtherDays] = useState<number | undefined>(p?.days !== undefined && !DAY_CHOICES.includes(p.days) ? p.days : undefined);
  useEffect(() => { if (p?.days !== undefined && !DAY_CHOICES.includes(p.days)) setOtherDays(p.days); }, [p?.days]);

  const save = (change: Partial<{ method: PaymentMethod | undefined; days: number | undefined; paid: boolean; paidAt: string | undefined }>) => {
    const next = { method: p?.method, days: p?.days, paid: p?.paid ?? false, paidAt: p?.paidAt, ...change };
    void run(() => setInvoicePayment(invoice.id, next));
  };
  const due = paymentDueDate(invoice);
  const overdue = !p?.paid && due && due < localYmd();

  return (
    <section className="invoice-pay" aria-label="Pago de la factura">
      <h3 className="row"><Wallet size={17} aria-hidden /> Pago</h3>
      {!editable && !p?.method && !p?.paid ? <p className="small muted">Sin datos de pago.</p> : (
        <div className="invoice-pay-grid">
          <div className="invoice-pay-field">
            <span className="invoice-pay-label">Forma de pago</span>
            {editable ? (
              <Segmented<PaymentMethod | ''> label="Forma de pago" value={p?.method ?? ''}
                onChange={(v) => save({ method: v === p?.method || !v ? undefined : v, days: v === 'echeq' ? (p?.days ?? 30) : undefined })}
                options={[{ value: 'echeq', label: PAYMENT_LABEL.echeq }, { value: 'efectivo', label: PAYMENT_LABEL.efectivo }, { value: 'transferencia', label: PAYMENT_LABEL.transferencia }]} />
            ) : <b>{p?.method ? PAYMENT_LABEL[p.method] : '—'}</b>}
          </div>

          {p?.method === 'echeq' && (
            <div className="invoice-pay-field">
              <span className="invoice-pay-label">A cuántos días</span>
              {editable ? (
                <div className="row wrap" style={{ gap: 6 }}>
                  <Segmented<string> label="Días del eCheq" value={p.days !== undefined && DAY_CHOICES.includes(p.days) ? String(p.days) : ''}
                    onChange={(v) => { setOtherDays(undefined); save({ days: Number(v) }); }}
                    options={DAY_CHOICES.map((d) => ({ value: String(d), label: d === 0 ? 'Al día' : `${d}` }))} />
                  <NumberInput aria-label="Otra cantidad de días" placeholder="Otro" min={0} value={otherDays} style={{ width: 84 }}
                    onChange={(v) => setOtherDays(v)} onBlur={() => { if (otherDays !== undefined && otherDays !== p.days) save({ days: otherDays }); }} />
                </div>
              ) : <b>{p.days === 0 ? 'Al día' : `${p.days ?? '—'} días`}</b>}
              {due && <span className={`small ${overdue ? 'neg' : 'muted'}`}>Se cobra el {fmtDay(due)}{overdue ? ' (ya pasó)' : ''}</span>}
            </div>
          )}

          <div className="invoice-pay-field">
            <span className="invoice-pay-label">¿Se pagó?</span>
            {editable ? (
              <Segmented<'no' | 'si'> label="¿Se pagó?" value={p?.paid ? 'si' : 'no'}
                onChange={(v) => save({ paid: v === 'si', paidAt: v === 'si' ? (p?.paidAt ?? localYmd()) : undefined })}
                options={[{ value: 'no', label: 'A pagar' }, { value: 'si', label: 'Pagada' }]} />
            ) : <b>{p?.paid ? 'Pagada' : 'A pagar'}</b>}
            {p?.paid && (editable ? (
              <label className="small row" style={{ gap: 6 }}>Fecha de pago
                <input className="input" type="date" value={p.paidAt ?? ''} style={{ width: 'auto' }} onChange={(e) => e.target.value && save({ paidAt: e.target.value })} />
              </label>
            ) : p.paidAt && <span className="small muted">el {fmtDay(p.paidAt)}</span>)}
          </div>
        </div>
      )}
      {p?.updatedBy && <p className="small muted" style={{ margin: 0 }}>Último cambio: {p.updatedBy.name}, {new Date(p.updatedAt).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
    </section>
  );
}

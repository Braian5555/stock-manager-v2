import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, History, Pencil, RotateCcw, Wallet } from 'lucide-react';
import { useState } from 'react';
import { db } from '../../database/db';
import type { Payment, SaleEdit, SalePaymentMethod, TableTicket, TicketCharge } from '../../models';
import { PAYMENT_LABEL } from '../../services/fiscalService';
import { blockingDocs, closedCashCharges, editChargePayments, editSaleInfo, reopenSale, voidSale } from '../../services/saleEditService';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { fmtDateTime, fmtMoney } from '../../utils/format';
import { Field, Input, NumberInput, Select } from '../ui';
import { Modal } from '../ui/Modal';

const METHODS = Object.keys(PAYMENT_LABEL) as SalePaymentMethod[];
const ACTION: Record<SaleEdit['action'], string> = { pagos: 'Medio de pago', datos: 'Datos', reabierta: 'Reabierta', anulada: 'Anulada' };

type Open = { kind: 'pagos'; charge: TicketCharge } | { kind: 'datos' } | { kind: 'reabrir' } | { kind: 'anular' } | null;

/**
 * Acciones sobre una venta cerrada (como "Ventas → Actualizar / Eliminar" de Fudo), según permisos:
 * cambiar el medio de pago, cambiar datos, reabrir para corregir y anular. Muestra el historial.
 */
export function SaleActions({ ticket, onDone }: { ticket: TableTicket; onDone?: (t: TableTicket) => void }) {
  const { can } = useSession();
  const canEdit = can('sales.edit') || can('admin');
  const canVoid = can('sales.void') || can('admin');
  const [open, setOpen] = useState<Open>(null);
  // Por qué no se puede reabrir/anular (factura de ARCA o caja cerrada).
  const lock = useLiveQuery(async () => {
    if (ticket.status !== 'cerrada') return { docs: 0, closed: 0 };
    return { docs: await blockingDocs(ticket), closed: (await closedCashCharges(ticket)).length };
  }, [ticket]);
  const edits = ticket.edits ?? [];
  const closed = ticket.status === 'cerrada';

  return (
    <>
      {closed && (canEdit || canVoid) && (
        <section className="sale-actions" aria-label="Cambiar la venta">
          {lock && lock.closed > 0 && <p className="small muted" style={{ margin: 0 }}>La caja de esta venta ya se cerró: no se puede cambiar.</p>}
          {lock && lock.closed === 0 && (
            <div className="row wrap" style={{ gap: 8 }}>
              {canEdit && (ticket.charges ?? []).map((c, i) => (
                <button key={c.id} type="button" className="btn btn-sm" onClick={() => setOpen({ kind: 'pagos', charge: c })}>
                  <Wallet size={16} aria-hidden /> Cambiar medio de pago{(ticket.charges ?? []).length > 1 ? ` (cobro ${i + 1})` : ''}
                </button>
              ))}
              {canEdit && <button type="button" className="btn btn-sm" onClick={() => setOpen({ kind: 'datos' })}><Pencil size={16} aria-hidden /> Cambiar datos</button>}
              {canEdit && lock.docs === 0 && <button type="button" className="btn btn-sm" onClick={() => setOpen({ kind: 'reabrir' })}><RotateCcw size={16} aria-hidden /> Reabrir para corregir</button>}
              {canVoid && lock.docs === 0 && <button type="button" className="btn btn-sm btn-danger" onClick={() => setOpen({ kind: 'anular' })}><Ban size={16} aria-hidden /> Anular venta</button>}
            </div>
          )}
          {lock && lock.docs > 0 && lock.closed === 0 && <p className="small muted" style={{ margin: 0 }}>Tiene factura de ARCA: lo vendido y el importe se corrigen con una nota de crédito desde Comprobantes.</p>}
        </section>
      )}

      {edits.length > 0 && (
        <section className="sale-history" aria-labelledby="sale-hist">
          <h3 id="sale-hist" className="salon-sub row" style={{ gap: 6 }}><History size={16} aria-hidden /> Cambios</h3>
          <ul className="small sale-history-list">
            {edits.map((e, i) => (
              <li key={i}>
                <b>{ACTION[e.action]}</b> · {fmtDateTime(e.at)}{e.by ? ` · ${e.by.name}` : ''}
                <br />Motivo: {e.reason}{e.detail ? <><br /><span className="muted">{e.detail}</span></> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {open?.kind === 'pagos' && <PaymentsModal ticket={ticket} charge={open.charge} onClose={() => setOpen(null)} onDone={onDone} />}
      {open?.kind === 'datos' && <InfoModal ticket={ticket} onClose={() => setOpen(null)} onDone={onDone} />}
      {(open?.kind === 'reabrir' || open?.kind === 'anular') && <ReasonModal ticket={ticket} kind={open.kind} onClose={() => setOpen(null)} onDone={onDone} />}
    </>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Motivo" hint="Obligatorio: queda anotado con tu nombre.">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ej.: se cobró con débito, no en efectivo" />
    </Field>
  );
}

function PaymentsModal({ ticket, charge, onClose, onDone }: { ticket: TableTicket; charge: TicketCharge; onClose: () => void; onDone?: (t: TableTicket) => void }) {
  const { run, notify } = useFeedback();
  const accounts = useLiveQuery(() => db.accounts.orderBy('name').toArray(), []) ?? [];
  const [pays, setPays] = useState<Payment[]>(() => charge.payments.map((p) => ({ ...p })));
  const [reason, setReason] = useState('');
  const set = (i: number, patch: Partial<Payment>) => setPays((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const sum = pays.reduce((s, p) => s + (p.amount || 0), 0);
  const save = () => void run(async () => {
    const t = await editChargePayments(ticket.id, charge.id, pays, reason);
    notify('Medio de pago cambiado');
    onDone?.(t);
    onClose();
  });
  return (
    <Modal open title="Cambiar medio de pago" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={save}>Guardar cambio</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>Cobro de {fmtMoney(charge.amount)}. La caja y la cuenta corriente se acomodan solas.</p>
      {pays.map((p, i) => (
        <div key={i} className="form-grid cols-2" style={{ marginBottom: 8 }}>
          <Field label={`Medio ${i + 1}`}>
            <Select aria-label={`Medio de pago ${i + 1}`} value={p.method} onChange={(e) => set(i, { method: e.target.value as SalePaymentMethod, accountId: undefined, accountName: undefined, note: undefined, received: undefined })}>
              {METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
            </Select>
          </Field>
          <Field label={`Importe ${i + 1}`}><NumberInput aria-label={`Importe ${i + 1}`} value={p.amount} onChange={(v) => set(i, { amount: v ?? 0 })} min={0} /></Field>
          {p.method === 'cuenta_corriente' && (
            <Field label="Cliente">
              <Select aria-label={`Cliente de cuenta corriente ${i + 1}`} value={p.accountId ?? ''} onChange={(e) => set(i, { accountId: e.target.value || undefined, accountName: accounts.find((a) => a.id === e.target.value)?.name })}>
                <option value="">Elegí el cliente…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          )}
          {p.method === 'invitacion' && <Field label="Motivo de la invitación"><Input aria-label={`Motivo de la invitación ${i + 1}`} value={p.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} /></Field>}
        </div>
      ))}
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn btn-sm" onClick={() => setPays((ps) => [...ps, { method: 'efectivo', amount: Math.max(0, Math.round((charge.amount - sum) * 100) / 100) }])}>Agregar otro medio</button>
        {pays.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPays((ps) => ps.slice(0, -1))}>Sacar el último</button>}
        <span className={`small ${Math.abs(sum - charge.amount) > 0.009 ? 'neg' : 'muted'}`}>Suman {fmtMoney(sum)} de {fmtMoney(charge.amount)}</span>
      </div>
      <ReasonField value={reason} onChange={setReason} />
    </Modal>
  );
}

function InfoModal({ ticket, onClose, onDone }: { ticket: TableTicket; onClose: () => void; onDone?: (t: TableTicket) => void }) {
  const { run, notify } = useFeedback();
  const users = useLiveQuery(() => db.users.filter((u) => u.active).toArray(), []) ?? [];
  const [guests, setGuests] = useState<number | undefined>(ticket.guests);
  const [waiterId, setWaiterId] = useState(ticket.openedBy?.id ?? '');
  const [name, setName] = useState(ticket.customer?.name ?? '');
  const [phone, setPhone] = useState(ticket.customer?.phone ?? '');
  const [reason, setReason] = useState('');
  const save = () => void run(async () => {
    const w = users.find((u) => u.id === waiterId);
    const t = await editSaleInfo(ticket.id, {
      guests: guests ?? 0,
      waiter: w ? { id: w.id, name: w.name } : undefined,
      customer: name || phone || ticket.customer ? { ...ticket.customer, name: name || undefined, phone: phone || undefined } : undefined,
    }, reason);
    notify('Datos de la venta cambiados');
    onDone?.(t);
    onClose();
  });
  return (
    <Modal open title="Cambiar datos de la venta" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={save}>Guardar cambio</button></>}>
      <div className="form-grid cols-2">
        <Field label="Comensales"><NumberInput value={guests} onChange={setGuests} min={0} /></Field>
        <Field label="Mozo / cajero">
          <Select value={waiterId} onChange={(e) => setWaiterId(e.target.value)}>
            {!ticket.openedBy && <option value="">—</option>}
            {ticket.openedBy && !users.some((u) => u.id === ticket.openedBy!.id) && <option value={ticket.openedBy.id}>{ticket.openedBy.name}</option>}
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
        <Field label="Cliente"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Teléfono"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
      </div>
      <ReasonField value={reason} onChange={setReason} />
    </Modal>
  );
}

function ReasonModal({ ticket, kind, onClose, onDone }: { ticket: TableTicket; kind: 'reabrir' | 'anular'; onClose: () => void; onDone?: (t: TableTicket) => void }) {
  const { run, notify } = useFeedback();
  const [reason, setReason] = useState('');
  const go = () => void run(async () => {
    const t = kind === 'reabrir' ? await reopenSale(ticket.id, reason) : await voidSale(ticket.id, reason);
    notify(kind === 'reabrir' ? 'Venta reabierta: corregila y cobrala de nuevo' : 'Venta anulada');
    onDone?.(t);
    onClose();
  });
  return (
    <Modal open title={kind === 'reabrir' ? 'Reabrir la venta' : 'Anular la venta'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className={`btn ${kind === 'anular' ? 'btn-danger' : 'btn-primary'}`} onClick={go}>{kind === 'reabrir' ? 'Reabrir' : 'Anular venta'}</button></>}>
      <p style={{ marginTop: 0 }}>
        {kind === 'reabrir'
          ? 'La venta vuelve a quedar abierta para corregir lo pedido y cobrarla de nuevo. Se sacan sus cobros (quedan anotados en el historial) y vuelve al stock lo que se había descontado.'
          : `Se anula la venta de ${fmtMoney(ticket.total)}: deja de contar en las ventas y en la caja, y vuelve al stock lo que se había descontado.`}
      </p>
      <ReasonField value={reason} onChange={setReason} />
    </Modal>
  );
}

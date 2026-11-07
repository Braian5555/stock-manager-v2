import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, BookUser, HandCoins, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db } from '../../database/db';
import { EMPTY } from '../../hooks/useData';
import type { CashMovement, CustomerAccount, DocTipo, SalePaymentMethod, TableTicket } from '../../models';
import { balances, ledger, recordAccountPayment, saveAccount, setAccountActive } from '../../services/accountService';
import { METHODS } from '../../services/cashService';
import { COND_IVA, DOC_TIPO_LABEL, PAYMENT_LABEL } from '../../services/fiscalService';
import { useFeedback } from '../../store/feedback';
import { fmtDateTime, fmtMoney } from '../../utils/format';
import { Badge, EmptyState, Field, Input, NumberInput, Select } from '../ui';
import { Modal } from '../ui/Modal';
import { useOpenCash } from './hooks';

/** Pedidos con algo cargado a cuenta corriente, y cobranzas (movimientos de caja con cliente). */
const useAccountData = () => {
  const accounts = (useLiveQuery(() => db.accounts.toArray(), []) ?? EMPTY) as CustomerAccount[];
  const tickets = (useLiveQuery(() => db.tickets.filter((t) => (t.charges ?? []).some((c) => c.payments.some((p) => p.method === 'cuenta_corriente'))).toArray(), []) ?? EMPTY) as TableTicket[];
  const movements = (useLiveQuery(() => db.cashMovements.filter((m) => !!m.accountId).toArray(), []) ?? EMPTY) as CashMovement[];
  return { accounts, tickets, movements };
};

/** Cuentas corrientes: saldo de cada cliente, su detalle y registrar pagos. */
export function AccountsTab() {
  const { accounts, tickets, movements } = useAccountData();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<CustomerAccount | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [paying, setPaying] = useState<CustomerAccount | null>(null);
  const rows = useMemo(() => balances(accounts, tickets, movements), [accounts, tickets, movements]);
  const visible = rows.filter((r) => showInactive || r.account.active || Math.abs(r.balance) > 0.009);
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const open = openId ? rows.find((r) => r.account.id === openId) : undefined;

  if (open) {
    const entries = ledger(open.account.id, tickets, movements).reverse();
    return (<>
      <section className="card card-pad stack" aria-label={`Cuenta de ${open.account.name}`}>
        <div className="row wrap">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)}><ArrowLeft size={16} aria-hidden /> Todas las cuentas</button>
          <span className="grow" />
          <button type="button" className="btn btn-sm" onClick={() => setEditing(open.account)}><Pencil size={16} aria-hidden /> Editar</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setPaying(open.account)}><HandCoins size={16} aria-hidden /> Registrar pago</button>
        </div>
        <h2 className="row" style={{ margin: 0 }}><BookUser size={20} aria-hidden /> {open.account.name}{!open.account.active && <Badge>inactivo</Badge>}</h2>
        {open.account.docNro && <p className="small muted" style={{ margin: 0 }}>{DOC_TIPO_LABEL[open.account.docTipo ?? 80]} {open.account.docNro}{open.account.condicionIva ? ` · ${COND_IVA[open.account.condicionIva]}` : ''}</p>}
        <div className="salon-stats">
          <div className="salon-stat"><span className="num">{fmtMoney(open.balance)}</span><span>{open.balance < -0.009 ? 'a favor del cliente' : 'debe'}</span></div>
          <div className="salon-stat"><span className="num">{fmtMoney(open.charged)}</span><span>cargado</span></div>
          <div className="salon-stat"><span className="num">{fmtMoney(open.paid)}</span><span>pagado</span></div>
        </div>
      </section>
      <section className="card" aria-labelledby="acc-moves">
        <div className="card-head"><h2 id="acc-moves">Movimientos</h2></div>
        {!entries.length ? <p className="muted card-pad" style={{ margin: 0 }}>Todavía no tiene movimientos.</p> : (
          <ul className="list">
            {entries.map((e) => (
              <li key={`${e.kind}-${e.ticketId ?? e.movementId}-${e.at}`} className="list-item">
                <span className="small muted cash-time">{fmtDateTime(e.at)}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="list-title truncate">{e.kind === 'cargo' ? e.label : `Pago${e.method ? ` en ${PAYMENT_LABEL[e.method].toLowerCase()}` : ''}`}</div>
                  <div className="list-sub truncate">{e.kind === 'pago' ? e.label : 'Cargado a cuenta corriente'}{e.by ? ` · ${e.by}` : ''} · saldo {fmtMoney(e.balance)}</div>
                </div>
                <b className={`num ${e.kind === 'pago' ? 'cash-pos' : ''}`}>{e.kind === 'pago' ? '−' : '+'}{fmtMoney(Math.abs(e.amount))}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && <AccountModal account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {paying && <PaymentModal account={paying} owed={open.balance} onClose={() => setPaying(null)} />}
    </>);
  }

  return (<>
    <section className="card card-pad stack" aria-label="Cuentas corrientes">
      <div className="row wrap">
        <div className="grow">
          <p style={{ margin: 0 }}>Total a cobrar: <b className="num">{fmtMoney(total)}</b></p>
          <p className="small muted" style={{ margin: 0 }}>Al cobrar una mesa elegí "Cuenta corriente" y el cliente. La plata entra en la caja recién cuando el cliente paga.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={18} aria-hidden /> Cliente nuevo</button>
      </div>
      {accounts.some((a) => !a.active) && <label className="check small"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inactivos</label>}
    </section>
    <section className="card" aria-label="Clientes">
      {!visible.length ? (
        <EmptyState icon={<BookUser size={28} />} title="Todavía no hay clientes de cuenta corriente">Agregá, por ejemplo, ALADES, los socios o el personal. También se pueden crear al cobrar una mesa.</EmptyState>
      ) : (
        <ul className="list">
          {visible.map((r) => (
            <li key={r.account.id} className="list-item">
              <button type="button" className="grow" style={{ minWidth: 0, overflow: 'hidden', textAlign: 'left', background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }} onClick={() => setOpenId(r.account.id)}>
                <div className="list-title truncate">{r.account.name}{!r.account.active && <> <Badge>inactivo</Badge></>}</div>
                <div className="list-sub truncate">cargado {fmtMoney(r.charged)} · pagado {fmtMoney(r.paid)}{r.lastAt ? ` · último ${fmtDateTime(r.lastAt)}` : ''}</div>
              </button>
              <b className={`num ${r.balance > 0.009 ? 'cash-neg' : ''}`}>{fmtMoney(r.balance)}</b>
              {r.balance > 0.009 && <button type="button" className="btn btn-sm" onClick={() => setPaying(r.account)}><HandCoins size={16} aria-hidden /> Pago</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
    {editing && <AccountModal account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    {paying && <PaymentModal account={paying} owed={rows.find((r) => r.account.id === paying.id)?.balance ?? 0} onClose={() => setPaying(null)} />}
  </>);
}

function AccountModal({ account, onClose }: { account?: CustomerAccount; onClose: () => void }) {
  const { run } = useFeedback();
  const [name, setName] = useState(account?.name ?? '');
  const [docTipo, setDocTipo] = useState<DocTipo>(account?.docTipo ?? 80);
  const [docNro, setDocNro] = useState(account?.docNro ?? '');
  const [condicionIva, setCondicionIva] = useState<number>(account?.condicionIva ?? 0);
  const [notes, setNotes] = useState(account?.notes ?? '');
  const save = () => void run(async () => {
    await saveAccount({ name, docTipo, docNro, condicionIva: condicionIva || undefined, notes }, account?.id);
    onClose();
  }, account ? 'Cliente guardado' : 'Cliente agregado');
  return (
    <Modal open title={account ? `Editar ${account.name}` : 'Cliente de cuenta corriente'} onClose={onClose}
      footer={<>
        {account && <button type="button" className="btn btn-ghost" onClick={() => void run(async () => { await setAccountActive(account.id, !account.active); onClose(); }, account.active ? 'Cliente desactivado' : 'Cliente activado')}>{account.active ? 'Desactivar' : 'Activar'}</button>}
        <span className="grow" />
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={save}>Guardar</button>
      </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: ALADES, Socio Juan Pérez, Personal" data-autofocus /></Field>
        <p className="small muted" style={{ margin: 0 }}>Opcional, para facturarle:</p>
        <div className="form-grid cols-2">
          <Field label="Documento">
            <Select value={docTipo} onChange={(e) => setDocTipo(Number(e.target.value) as DocTipo)}>
              {([80, 96, 86] as DocTipo[]).map((t) => <option key={t} value={t}>{DOC_TIPO_LABEL[t]}</option>)}
            </Select>
          </Field>
          <Field label="Número"><Input value={docNro} inputMode="numeric" onChange={(e) => setDocNro(e.target.value)} /></Field>
          <Field label="Condición frente al IVA">
            <Select value={condicionIva} onChange={(e) => setCondicionIva(Number(e.target.value))}>
              <option value={0}>—</option>
              {Object.entries(COND_IVA).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Notas"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function PaymentModal({ account, owed, onClose }: { account: CustomerAccount; owed: number; onClose: () => void }) {
  const { run } = useFeedback();
  const cash = useOpenCash();
  const [amount, setAmount] = useState<number | undefined>(owed > 0 ? owed : undefined);
  const [method, setMethod] = useState<SalePaymentMethod>('transferencia');
  const [note, setNote] = useState('');
  const save = () => void run(async () => { await recordAccountPayment(account.id, amount ?? 0, method, note); onClose(); }, 'Pago registrado');
  return (
    <Modal open title={`Pago de ${account.name}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" disabled={!cash} onClick={save}>Registrar pago</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (cash) save(); }}>
        <p style={{ margin: 0 }}>Debe <b className="num">{fmtMoney(owed)}</b>.</p>
        {!cash && <div className="alert alert-info" role="note"><span>Para registrar un pago tiene que haber una caja abierta: el pago entra en esa caja (Salón → Caja).</span></div>}
        <div className="form-grid cols-2">
          <Field label="Importe"><NumberInput value={amount} onChange={setAmount} min={0} data-autofocus /></Field>
          <Field label="Medio"><Select value={method} onChange={(e) => setMethod(e.target.value as SalePaymentMethod)}>{METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}</Select></Field>
        </div>
        <Field label="Nota (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: transferencia del 7/11" /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

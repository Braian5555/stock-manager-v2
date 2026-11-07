import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownCircle, ArrowUpCircle, Lock, Printer, Unlock, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db } from '../../database/db';
import { EMPTY } from '../../hooks/useData';
import type { CashMovement, CashSession, SalePaymentMethod, TableTicket } from '../../models';
import { METHODS, addMovement, chargesOf, closeCash, differences, openCash, summarize } from '../../services/cashService';
import { PAYMENT_LABEL } from '../../services/fiscalService';
import { arqueoHtml, printHtml } from '../../services/printService';
import { ticketLabel } from '../../services/salonService';
import { useFeedback } from '../../store/feedback';
import { useSettings } from '../../store/settings';
import { fmtDateTime, fmtMoney, fmtTime } from '../../utils/format';
import { Badge, EmptyState, Field, Input, NumberInput, Segmented, Select } from '../ui';
import { Modal } from '../ui/Modal';
import { useOpenCash } from './hooks';

const useSessionData = (id?: string) => {
  const tickets = (useLiveQuery(() => (id ? db.tickets.filter((t) => (t.charges ?? []).some((c) => c.cashSessionId === id)).toArray() : []), [id]) ?? EMPTY) as TableTicket[];
  const movements = (useLiveQuery(() => (id ? db.cashMovements.where('sessionId').equals(id).sortBy('at') : []), [id]) ?? EMPTY) as CashMovement[];
  return { tickets, movements };
};

/** Caja: apertura, ingresos y egresos, propinas y cierre con arqueo por medio de pago. */
export function CashTab() {
  const session = useOpenCash();
  const history = (useLiveQuery(() => db.cashSessions.where('status').equals('cerrada').reverse().sortBy('closedAt'), []) ?? EMPTY) as CashSession[];
  const [detail, setDetail] = useState<CashSession | null>(null);
  if (session === undefined) return null;
  return (<>
    {session ? <OpenCash session={session} /> : <ClosedCash lastClose={history[0]?.closedAt} />}
    {history.length > 0 && (
      <section className="card" aria-labelledby="cash-history">
        <div className="card-head"><h2 id="cash-history">Cajas cerradas</h2></div>
        <ul className="list">
          {history.slice(0, 20).map((s) => {
            const diff = differences(s).reduce((x, d) => x + d.diff, 0);
            return (
              <li key={s.id} className="list-item">
                <button type="button" className="list-btn grow" onClick={() => setDetail(s)}>
                  <span className="list-title">{s.register} #{s.number}</span>
                  <span className="list-sub">{fmtDateTime(s.openedAt)} – {fmtTime(s.closedAt)}{s.closedBy ? ` · ${s.closedBy.name}` : ''}</span>
                </button>
                <Badge tone={Math.abs(diff) < 0.01 ? 'ok' : diff > 0 ? 'info' : 'danger'}>{Math.abs(diff) < 0.01 ? 'Sin diferencia' : diff > 0 ? `Sobró ${fmtMoney(diff)}` : `Faltó ${fmtMoney(-diff)}`}</Badge>
              </li>
            );
          })}
        </ul>
      </section>
    )}
    {detail && <SessionDetail session={detail} onClose={() => setDetail(null)} />}
  </>);
}

function ClosedCash({ lastClose }: { lastClose?: string }) {
  const { run } = useFeedback();
  const [initial, setInitial] = useState<number | undefined>();
  const [register, setRegister] = useState('Caja');
  const orphans = (useLiveQuery(() => db.tickets.filter((t) => (t.charges ?? []).some((c) => !c.cashSessionId && c.at > (lastClose ?? ''))).toArray(), [lastClose]) ?? EMPTY) as TableTicket[];
  const orphanTotal = orphans.reduce((s, t) => s + (t.charges ?? []).filter((c) => !c.cashSessionId && c.at > (lastClose ?? '')).reduce((x, c) => x + c.amount, 0), 0);
  return (
    <section className="card card-pad stack cash-closed" aria-label="Abrir caja">
      <h2 className="row"><Lock size={20} aria-hidden /> La caja está cerrada</h2>
      <p className="small muted" style={{ margin: 0 }}>Abrila con el efectivo que hay al empezar el turno. Los cobros quedan anotados en esta caja hasta que la cierres.</p>
      {orphanTotal > 0 && <p className="small" style={{ margin: 0 }}>Hay {fmtMoney(orphanTotal)} cobrados sin caja abierta: entran en esta caja.</p>}
      <form className="salon-first" style={{ padding: 0 }} onSubmit={(e) => { e.preventDefault(); void run(() => openCash(initial ?? 0, register), 'Caja abierta'); }}>
        <Field label="Efectivo inicial"><NumberInput value={initial} onChange={setInitial} min={0} placeholder="0" /></Field>
        <Field label="Caja"><Input value={register} onChange={(e) => setRegister(e.target.value)} /></Field>
        <button type="submit" className="btn btn-primary"><Unlock size={18} aria-hidden /> Abrir caja</button>
      </form>
    </section>
  );
}

function SummaryTable({ session, tickets, movements }: { session: CashSession; tickets: TableTicket[]; movements: CashMovement[] }) {
  const sum = summarize(session, tickets, movements);
  const rows = METHODS.filter((m) => sum.expected[m] || sum.sales[m] || sum.tips[m] || sum.ingresos[m] || sum.egresos[m] || m === 'efectivo');
  return (
    <div className="cash-table-wrap">
      <table className="cash-table">
        <thead><tr><th scope="col">Medio</th><th scope="col">Ventas</th><th scope="col" className="cash-opt">Propinas</th><th scope="col" className="cash-opt">Ingresos</th><th scope="col" className="cash-opt">Egresos</th><th scope="col">Esperado</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m}>
              <th scope="row">{PAYMENT_LABEL[m]}{m === 'efectivo' ? <span className="small muted cash-initial">inicial {fmtMoney(session.initialCash)}</span> : null}</th>
              <td className="num">{fmtMoney(sum.sales[m])}</td><td className="num cash-opt">{fmtMoney(sum.tips[m])}</td><td className="num cash-opt">{fmtMoney(sum.ingresos[m])}</td><td className="num cash-opt">{fmtMoney(sum.egresos[m])}</td>
              <td className="num"><b>{fmtMoney(sum.expected[m])}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><th scope="row">Total</th><td className="num">{fmtMoney(sum.totalSales)}</td><td className="num cash-opt">{fmtMoney(sum.totalTips)}</td><td className="cash-opt" colSpan={2} /><td className="num"><b>{fmtMoney(METHODS.reduce((s, m) => s + sum.expected[m], 0))}</b></td></tr></tfoot>
      </table>
    </div>
  );
}

function OpenCash({ session }: { session: CashSession }) {
  const settings = useSettings();
  const { run } = useFeedback();
  const { tickets, movements } = useSessionData(session.id);
  const [mov, setMov] = useState<'ingreso' | 'egreso' | null>(null);
  const [closing, setClosing] = useState(false);
  const sum = useMemo(() => summarize(session, tickets, movements), [session, tickets, movements]);
  const charges = chargesOf(tickets, session.id);
  return (<>
    <section className="card card-pad stack" aria-label="Caja abierta">
      <div className="row wrap cash-head">
        <h2 className="row grow"><Wallet size={20} aria-hidden /> {session.register} #{session.number} abierta</h2>
        <span className="small muted">desde {fmtTime(session.openedAt)}{session.openedBy ? ` · ${session.openedBy.name}` : ''}</span>
      </div>
      <div className="salon-stats">
        <div className="salon-stat"><span className="num">{fmtMoney(sum.totalSales)}</span><span>vendido ({sum.count} {sum.count === 1 ? 'cobro' : 'cobros'})</span></div>
        <div className="salon-stat"><span className="num">{fmtMoney(sum.expected.efectivo)}</span><span>efectivo en caja</span></div>
        <div className="salon-stat"><span className="num">{fmtMoney(sum.totalTips)}</span><span>propinas</span></div>
        <div className="salon-stat"><span className="num">{fmtMoney(METHODS.reduce((s, m) => s + sum.egresos[m], 0))}</span><span>egresos</span></div>
        {sum.onAccount > 0 && <div className="salon-stat"><span className="num">{fmtMoney(sum.onAccount)}</span><span>a cuenta corriente (no entra en caja)</span></div>}
        {sum.invitations > 0 && <div className="salon-stat"><span className="num">{fmtMoney(sum.invitations)}</span><span>invitaciones</span></div>}
      </div>
      <SummaryTable session={session} tickets={tickets} movements={movements} />
      <div className="row wrap">
        <button type="button" className="btn" onClick={() => setMov('ingreso')}><ArrowDownCircle size={18} aria-hidden /> Ingreso</button>
        <button type="button" className="btn" onClick={() => setMov('egreso')}><ArrowUpCircle size={18} aria-hidden /> Egreso</button>
        <button type="button" className="btn btn-ghost" onClick={() => void run(() => printHtml(arqueoHtml(session, sum, settings.businessName, [])))}><Printer size={18} aria-hidden /> Imprimir parcial</button>
        <span className="grow" />
        <button type="button" className="btn btn-primary" onClick={() => setClosing(true)}><Lock size={18} aria-hidden /> Cerrar caja</button>
      </div>
    </section>
    <section className="card" aria-labelledby="cash-moves">
      <div className="card-head"><h2 id="cash-moves">Movimientos del turno</h2></div>
      {charges.length + movements.length === 0 ? <p className="muted card-pad" style={{ margin: 0 }}>Todavía no hubo cobros ni movimientos.</p> : (
        <ul className="list">
          {[...charges.map((c) => ({ at: c.charge.at, key: c.charge.id, title: `${ticketLabel(c.ticket)}${c.charge.label ? ` · ${c.charge.label}` : ''}`, sub: c.charge.payments.map((p) => `${PAYMENT_LABEL[p.method]} ${fmtMoney(p.amount)}`).join(' + ') + (c.charge.tip ? ` · propina ${fmtMoney(c.charge.tip.amount)}` : ''), amount: c.charge.amount + (c.charge.tip?.amount ?? 0), sign: 1 })),
            ...movements.map((m) => ({ at: m.at, key: m.id, title: `${m.kind === 'ingreso' ? 'Ingreso' : 'Egreso'}: ${m.reason}`, sub: `${PAYMENT_LABEL[m.method]}${m.by ? ` · ${m.by.name}` : ''}`, amount: m.amount, sign: m.kind === 'ingreso' ? 1 : -1 }))]
            .sort((a, b) => b.at.localeCompare(a.at)).map((r) => (
              <li key={r.key} className="list-item">
                <span className="num small muted cash-time">{fmtTime(r.at)}</span>
                <div className="grow"><div className="list-title truncate">{r.title}</div><div className="list-sub truncate">{r.sub}</div></div>
                <b className={`num ${r.sign < 0 ? 'cash-neg' : ''}`}>{r.sign < 0 ? '−' : ''}{fmtMoney(r.amount)}</b>
              </li>
            ))}
        </ul>
      )}
    </section>
    {mov && <MovementModal kind={mov} onClose={() => setMov(null)} />}
    {closing && <CloseModal session={session} expected={sum.expected} onClose={() => setClosing(false)} />}
  </>);
}

function MovementModal({ kind, onClose }: { kind: 'ingreso' | 'egreso'; onClose: () => void }) {
  const { run } = useFeedback();
  const [amount, setAmount] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<SalePaymentMethod>('efectivo');
  const save = () => void run(async () => { await addMovement(kind, amount ?? 0, reason, method); onClose(); }, kind === 'ingreso' ? 'Ingreso anotado' : 'Egreso anotado');
  return (
    <Modal open title={kind === 'ingreso' ? 'Ingreso de dinero' : 'Egreso de dinero'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="group-chips">
          {(kind === 'egreso' ? ['Pago a proveedor', 'Compra', 'Retiro', 'Adelanto'] : ['Cambio', 'Aporte']).map((r) => <button key={r} type="button" className="group-chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}
        </div>
        <div className="form-grid cols-2">
          <Field label="Importe"><NumberInput value={amount} onChange={setAmount} min={0} data-autofocus /></Field>
          <Field label="Medio"><Select value={method} onChange={(e) => setMethod(e.target.value as SalePaymentMethod)}>{METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}</Select></Field>
        </div>
        <Field label={kind === 'egreso' ? 'En qué se gastó' : 'De qué es'}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function CloseModal({ session, expected, onClose }: { session: CashSession; expected: Record<SalePaymentMethod, number>; onClose: () => void }) {
  const settings = useSettings();
  const { run, confirm } = useFeedback();
  const methods = METHODS.filter((m) => expected[m] !== 0 || m === 'efectivo');
  const [counted, setCounted] = useState<Partial<Record<SalePaymentMethod, number>>>({});
  const [note, setNote] = useState('');
  const [blind, setBlind] = useState<'ver' | 'ciega'>('ver');
  const diffOf = (m: SalePaymentMethod) => (counted[m] === undefined ? 0 : Math.round(((counted[m] ?? 0) - expected[m]) * 100) / 100);
  const total = methods.reduce((s, m) => s + diffOf(m), 0);
  const close = async () => {
    if (methods.some((m) => counted[m] === undefined)) {
      const ok = await confirm({ title: '¿Cerrar sin contar todo?', message: 'Lo que no cuentes se toma igual a lo esperado.', confirmLabel: 'Cerrar igual' });
      if (!ok) return;
    }
    const s = await run(() => closeCash(session.id, counted, note), 'Caja cerrada');
    if (!s) return;
    onClose();
    const tickets = await db.tickets.filter((t) => (t.charges ?? []).some((c) => c.cashSessionId === s.id)).toArray();
    const movements = await db.cashMovements.where('sessionId').equals(s.id).toArray();
    if (await confirm({ title: 'Caja cerrada', message: '¿Imprimir el arqueo?', confirmLabel: 'Imprimir' })) void printHtml(arqueoHtml(s, summarize(s, tickets, movements), settings.businessName, differences(s)));
  };
  return (
    <Modal open title={`Cerrar ${session.register} #${session.number}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void close()}><Lock size={18} aria-hidden /> Cerrar caja</button></>}>
      <div className="stack">
        <Segmented<'ver' | 'ciega'> label="Arqueo" value={blind} onChange={setBlind} options={[{ value: 'ver', label: 'Ver lo esperado' }, { value: 'ciega', label: 'Arqueo ciego' }]} />
        <p className="small muted" style={{ margin: 0 }}>Contá lo que hay de cada medio de pago (el efectivo de la caja, los cupones de tarjeta, las transferencias recibidas).</p>
        <table className="cash-table">
          <thead><tr><th scope="col">Medio</th>{blind === 'ver' && <th scope="col">Esperado</th>}<th scope="col">Contado</th>{blind === 'ver' && <th scope="col">Diferencia</th>}</tr></thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m}>
                <th scope="row">{PAYMENT_LABEL[m]}</th>
                {blind === 'ver' && <td className="num">{fmtMoney(expected[m])}</td>}
                <td><NumberInput aria-label={`Contado ${PAYMENT_LABEL[m]}`} value={counted[m]} onChange={(v) => setCounted((c) => ({ ...c, [m]: v }))} min={0} /></td>
                {blind === 'ver' && <td className={`num ${diffOf(m) < 0 ? 'cash-neg' : diffOf(m) > 0 ? 'cash-pos' : ''}`}>{counted[m] === undefined ? '—' : diffOf(m) === 0 ? 'Justo' : `${diffOf(m) > 0 ? '+' : '−'}${fmtMoney(Math.abs(diffOf(m)))}`}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {blind === 'ver' && <p className={`cash-diff ${total < 0 ? 'cash-neg' : total > 0 ? 'cash-pos' : ''}`}>{Math.abs(total) < 0.01 ? 'Sin diferencia' : total > 0 ? `Sobran ${fmtMoney(total)}` : `Faltan ${fmtMoney(-total)}`}</p>}
        <Field label="Comentario (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="small muted" style={{ margin: 0 }}>Una caja cerrada no se puede volver a abrir.</p>
      </div>
    </Modal>
  );
}

function SessionDetail({ session, onClose }: { session: CashSession; onClose: () => void }) {
  const settings = useSettings();
  const { run } = useFeedback();
  const { tickets, movements } = useSessionData(session.id);
  const diffs = differences(session);
  return (
    <Modal open wide title={`${session.register} #${session.number}`} onClose={onClose}
      footer={<button type="button" className="btn" onClick={() => void run(() => printHtml(arqueoHtml(session, summarize(session, tickets, movements), settings.businessName, diffs)))}><Printer size={18} aria-hidden /> Imprimir arqueo</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Abierta {fmtDateTime(session.openedAt)}{session.openedBy ? ` por ${session.openedBy.name}` : ''} · cerrada {fmtDateTime(session.closedAt)}{session.closedBy ? ` por ${session.closedBy.name}` : ''}</p>
      <SummaryTable session={session} tickets={tickets} movements={movements} />
      <h3 className="salon-sub">Arqueo</h3>
      {diffs.length === 0 ? <p className="muted">Sin movimientos.</p> : (
        <table className="cash-table">
          <thead><tr><th scope="col">Medio</th><th scope="col">Esperado</th><th scope="col">Contado</th><th scope="col">Diferencia</th></tr></thead>
          <tbody>{diffs.map((d) => <tr key={d.method}><th scope="row">{PAYMENT_LABEL[d.method]}</th><td className="num">{fmtMoney(d.expected)}</td><td className="num">{fmtMoney(d.counted)}</td><td className={`num ${d.diff < 0 ? 'cash-neg' : d.diff > 0 ? 'cash-pos' : ''}`}>{d.diff === 0 ? 'Justo' : `${d.diff > 0 ? '+' : '−'}${fmtMoney(Math.abs(d.diff))}`}</td></tr>)}</tbody>
        </table>
      )}
      {session.note && <p className="small">Comentario: {session.note}</p>}
      {!tickets.length && !movements.length && <EmptyState icon={<Wallet size={32} />} title="Sin cobros">Esta caja no tuvo cobros ni movimientos.</EmptyState>}
    </Modal>
  );
}

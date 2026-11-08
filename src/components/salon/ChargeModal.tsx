import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Minus, Plus, Printer, RotateCcw, Trash2, TriangleAlert, Wallet } from 'lucide-react';
import { saveAccount } from '../../services/accountService';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../database/db';
import type { DocTipo, FiscalDoc, FiscalReceptor, Payment, SalePaymentMethod, TableTicket } from '../../models';
import {
  CBTE_NAME, COND_IVA, CONSUMIDOR_FINAL, CF_ID_THRESHOLD, DOC_TIPO_LABEL, PAYMENT_LABEL, chargeTicket, docNumber, fiscalOf, fiscalReady, invoiceLater, issue, itemsAmount,
  isMoneyMethod, letterFor, paymentProblems, receptorProblems, recentReceptors, ymdToDate, type ChargePart,
} from '../../services/fiscalService';
import { fiscalTicketHtml, fiscalHeader, printHtml } from '../../services/printService';
import { chargedAmount, closeTicket, paidQty, remainingAmount, ticketLabel } from '../../services/salonService';
import { useFeedback } from '../../store/feedback';
import { useSettings } from '../../store/settings';
import { fmtMoney } from '../../utils/format';
import { Field, Input, NumberInput, Segmented, Select } from '../ui';
import { Modal } from '../ui/Modal';
import { useOpenCash } from './hooks';

type InvoiceMode = 'cf' | 'datos' | 'no';
type SplitMode = 'todo' | 'partes' | 'items';
const METHODS = Object.keys(PAYMENT_LABEL) as SalePaymentMethod[];
/** La propina siempre es plata. */
const TIP_METHODS = METHODS.filter(isMoneyMethod);
const NEW_ACCOUNT = '__nuevo';
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Cobrar la cuenta: todo junto o dividida (partes iguales o por ítems), medios de pago, propina,
 * datos del cliente y factura electrónica de cada parte. Queda anotado en la caja abierta.
 * Si ARCA no contesta, se cobra igual y el comprobante queda para reintentar en Comprobantes.
 */
export function ChargeModal({ ticket: initial, onClose }: { ticket: TableTicket; onClose: (closed: boolean) => void }) {
  const settings = useSettings();
  const f = fiscalOf(settings);
  const billing = fiscalReady(f);
  const cash = useOpenCash();
  const { run, notify } = useFeedback();
  const ticket = useLiveQuery(() => db.tickets.get(initial.id), [initial.id]) ?? initial;
  const accounts = useLiveQuery(async () => (await db.accounts.toArray()).filter((a) => a.active).sort((a, b) => a.name.localeCompare(b.name, 'es')), []) ?? [];
  const [newAccount, setNewAccount] = useState<{ row: number; name: string } | null>(null);
  const label = ticketLabel(ticket);
  const remaining = remainingAmount(ticket);
  const charged = chargedAmount(ticket);
  const [split, setSplit] = useState<SplitMode>(charged > 0 ? 'partes' : 'todo');
  const [parts, setParts] = useState(2);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [payments, setPayments] = useState<Payment[]>([{ method: 'efectivo', amount: remaining }]);
  const [tip, setTip] = useState<number | undefined>();
  const [tipMethod, setTipMethod] = useState<SalePaymentMethod | ''>('');
  const [mode, setMode] = useState<InvoiceMode>(billing ? 'cf' : 'no');
  const [rec, setRec] = useState<FiscalReceptor>({ docTipo: 80, docNro: '', condicionIva: 1 });
  const [recent, setRecent] = useState<FiscalReceptor[]>([]);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<FiscalDoc | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => { if (billing) void recentReceptors().then(setRecent); }, [billing]);

  // Cuánto se cobra ahora.
  const done = (ticket.charges ?? []).length;
  const partNo = Math.min(parts, done + 1);
  const itemsSel = Object.entries(sel).filter(([, q]) => q > 0).map(([lineId, qty]) => ({ lineId, qty }));
  const amount = split === 'todo' ? remaining
    : split === 'partes' ? (partNo >= parts ? remaining : Math.min(remaining, round2(ticket.total / parts)))
    : Math.min(remaining, itemsAmount(ticket, itemsSel));
  const part: ChargePart = split === 'todo' ? { kind: 'rest' } : split === 'partes' ? { kind: 'equal', amount, label: `${partNo} de ${parts}` } : { kind: 'items', items: itemsSel };
  useEffect(() => { setPayments((xs) => [{ ...xs[0], amount, received: undefined }]); }, [amount]);

  const paid = round2(payments.reduce((s, p) => s + (p.amount || 0), 0));
  const left = round2(amount - paid);
  const cashPay = payments.find((p) => p.method === 'efectivo');
  const change = cashPay?.received && cashPay.received > cashPay.amount + (tipMethod === 'efectivo' || (!tipMethod && payments[0].method === 'efectivo') ? tip ?? 0 : 0) ? round2(cashPay.received - cashPay.amount - ((tipMethod || payments[0].method) === 'efectivo' ? tip ?? 0 : 0)) : 0;
  const receptor: FiscalReceptor = mode === 'datos' ? rec : CONSUMIDOR_FINAL;
  const letra = letterFor(f, receptor.condicionIva);
  const tipInfo = useMemo(() => (tip ? { amount: tip, method: tipMethod || (isMoneyMethod(payments[0].method) ? payments[0].method : 'efectivo' as SalePaymentMethod) } : undefined), [tip, tipMethod, payments]);
  const hasInvitation = payments.some((p) => p.method === 'invitacion' && p.amount > 0);
  const payProblems = useMemo(() => [
    ...paymentProblems(payments, tipInfo),
    ...(hasInvitation && mode !== 'no' ? ['Las invitaciones no se facturan: elegí "Sin factura por ahora" o cobrá esa parte por separado.'] : []),
  ], [payments, tipInfo, hasInvitation, mode]);
  const problems = useMemo(() => [...payProblems, ...(mode === 'no' ? [] : receptorProblems(receptor, letra, amount))], [payProblems, mode, receptor, letra, amount]);
  const cfTooBig = mode === 'cf' && amount >= CF_ID_THRESHOLD;

  const setPay = (i: number, p: Partial<Payment>) => setPayments((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const addPay = () => setPayments((xs) => [...xs, { method: xs.some((x) => x.method === 'debito') ? 'transferencia' : 'debito', amount: Math.max(0, left) }]);

  const finishIfPaid = async (rest: number) => {
    if (rest > 0.009) return false;
    const ok = await run(() => closeTicket(ticket.id));
    if (ok) setClosed(true);
    return true;
  };

  const submit = async () => {
    if (!(amount > 0)) return notify(split === 'items' ? 'Elegí qué se paga.' : 'No queda nada por cobrar.', { tone: 'error' });
    if (Math.abs(left) > 0.009) return notify(left > 0 ? `Faltan ${fmtMoney(left)} para completar lo que se cobra.` : `Los pagos superan lo que se cobra por ${fmtMoney(-left)}.`, { tone: 'error' });
    if (problems.length) return notify(problems.join(' '), { tone: 'error' });
    setBusy(true);
    try {
      const clean: Payment[] = payments.filter((p) => p.amount > 0).map((p) => (
        p.method === 'efectivo' && p.received ? { method: p.method, amount: p.amount, received: p.received }
          : p.method === 'cuenta_corriente' ? { method: p.method, amount: p.amount, accountId: p.accountId, accountName: accounts.find((a) => a.id === p.accountId)?.name ?? p.accountName }
          : p.method === 'invitacion' ? { method: p.method, amount: p.amount, note: p.note?.trim() }
          : { method: p.method, amount: p.amount }));
      const r = await run(() => chargeTicket(ticket.id, {
        payments: clean, invoice: mode === 'no' ? false : { receptor }, part,
        ...(tipInfo ? { tip: tipInfo } : {}),
      }));
      if (!r) return;
      setSel({});
      setTip(undefined);
      const all = await finishIfPaid(r.remaining);
      if (r.doc) setDoc(r.doc);
      else if (all) { notify(`${label}: cobrado y cerrado`); onClose(true); }
      else notify(`Parte cobrada. Faltan ${fmtMoney(r.remaining)}.`);
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const charge = (ticket.charges ?? []).find((c) => c.fiscalDocId === doc.id);
      const next = doc.status === 'rechazada' || (doc.status === 'error' && !doc.attempt)
        ? await run(() => invoiceLater(ticket.id, receptor, charge?.id))
        : await run(() => issue(doc.id));
      if (next) setDoc(next);
    } finally {
      setBusy(false);
    }
  };

  const print = async (d: FiscalDoc) => run(async () => printHtml(await fiscalTicketHtml(d, f.pie, fiscalHeader(settings))));
  const afterResult = () => { if (closed || remaining <= 0.009) onClose(true); else setDoc(null); };

  // ── Resultado de la factura ──
  if (doc) {
    const ok = doc.status === 'autorizada';
    const canFix = doc.status === 'rechazada' || (doc.status === 'error' && !doc.attempt);
    return (
      <Modal open title={label} onClose={() => onClose(closed)}
        footer={<>
          {!ok && <button type="button" className="btn" disabled={busy} onClick={() => void retry()}><RotateCcw size={18} aria-hidden /> {busy ? 'Enviando…' : canFix ? 'Volver a emitir' : 'Reintentar'}</button>}
          {ok && <button type="button" className="btn" onClick={() => void print(doc)}><Printer size={18} aria-hidden /> Imprimir ticket</button>}
          <button type="button" className="btn btn-primary" onClick={afterResult}>{remaining > 0.009 && !closed ? `Seguir cobrando (${fmtMoney(remaining)})` : 'Listo'}</button>
        </>}>
        {ok ? (
          <div className="fiscal-result is-ok" role="status">
            <CheckCircle2 size={28} aria-hidden />
            <div>
              <p className="fiscal-result-title">{CBTE_NAME[doc.cbteTipo]} {docNumber(doc)} autorizada</p>
              <p className="small">CAE {doc.cae} · vence {ymdToDate(doc.caeVto)} · {fmtMoney(doc.impTotal)}{doc.ambiente === 'homologacion' ? ' · PRUEBA (homologación)' : ''}</p>
              {!!doc.obs?.length && <p className="small muted">ARCA observó: {doc.obs.map((o) => `${o.code} ${o.msg}`).join(' · ')}</p>}
            </div>
          </div>
        ) : (
          <div className="fiscal-result is-warn" role="alert">
            <TriangleAlert size={28} aria-hidden />
            <div>
              <p className="fiscal-result-title">{doc.status === 'rechazada' ? 'ARCA rechazó la factura' : doc.status === 'incierta' ? 'No se sabe si ARCA la autorizó' : 'No se pudo emitir la factura'}</p>
              <p className="small">{doc.message}</p>
              <p className="small muted">El cobro ya quedó anotado. {canFix ? 'Corregí los datos del cliente y volvé a emitir,' : 'Podés reintentar ahora'} o más tarde desde Comprobantes. {doc.status === 'incierta' ? 'Al reintentar se consulta en ARCA antes de pedir otra: no se duplica.' : ''}</p>
            </div>
          </div>
        )}
        {remaining > 0.009 && !closed && <p className="small">Falta cobrar {fmtMoney(remaining)} de esta cuenta.</p>}
        {canFix && <ReceptorForm rec={rec} setRec={setRec} recent={recent} letra={letterFor(f, rec.condicionIva)} />}
      </Modal>
    );
  }

  const payable = ticket.lines.filter((l) => l.qty > 0 && !l.comp);

  // ── Cobro ──
  return (
    <Modal open wide title={`Cobrar · ${label}`} onClose={() => onClose(false)}
      footer={<>
        <div className="salon-total"><span>{split === 'todo' && !charged ? 'Total' : 'Se cobra'}</span><b className="num">{fmtMoney(amount)}</b></div>
        <button type="button" className="btn btn-primary" disabled={busy || !(amount > 0) || Math.abs(left) > 0.009 || problems.length > 0} onClick={() => void submit()}>
          {busy ? (mode === 'no' ? 'Cobrando…' : 'Facturando…') : mode === 'no' ? (amount >= remaining - 0.009 ? (payments.every((p) => !isMoneyMethod(p.method)) ? `Cerrar mesa (${fmtMoney(amount)})` : `Cobrar ${fmtMoney(amount)} y cerrar`) : `Cobrar ${fmtMoney(amount)}`) : `Cobrar y emitir Factura ${letra}`}
        </button>
      </>}>
      {cash === null && <div className="alert alert-info" role="note"><Wallet size={18} aria-hidden /><span>No hay caja abierta: este cobro entra en la próxima caja que se abra (Salón → Caja).</span></div>}
      {(charged > 0 || ticket.discount) && (
        <p className="small charge-summary">Total {fmtMoney(ticket.total)}{ticket.discount ? ' (con descuento)' : ''}{charged > 0 ? ` · ya cobrado ${fmtMoney(charged)} · falta ${fmtMoney(remaining)}` : ''}</p>
      )}

      <section className="stack" aria-labelledby="charge-split">
        <h3 id="charge-split" className="salon-sub" style={{ marginTop: 0 }}>Cuenta</h3>
        <Segmented<SplitMode> label="Cómo se paga" value={split} onChange={setSplit}
          options={[{ value: 'todo', label: charged > 0 ? 'Todo lo que falta' : 'Todo junto' }, { value: 'partes', label: 'Partes iguales' }, { value: 'items', label: 'Por ítems' }]} />
        {split === 'partes' && (
          <div className="row wrap charge-parts">
            <span className="salon-qty" role="group" aria-label="Cantidad de partes">
              <button type="button" className="btn btn-ghost icon-btn" aria-label="Una parte menos" disabled={parts <= Math.max(2, done + 1)} onClick={() => setParts((n) => n - 1)}><Minus size={16} /></button>
              <b className="num">{parts}</b>
              <button type="button" className="btn btn-ghost icon-btn" aria-label="Una parte más" onClick={() => setParts((n) => Math.min(30, n + 1))}><Plus size={16} /></button>
            </span>
            <span>partes de {fmtMoney(round2(ticket.total / parts))} · cobrando la <b>{partNo} de {parts}</b></span>
          </div>
        )}
        {split === 'items' && (
          <ul className="salon-lines charge-items" aria-label="Qué se paga">
            {payable.map((l) => {
              const max = round2(l.qty - paidQty(ticket, l.id));
              const q = sel[l.id] ?? 0;
              return (
                <li key={l.id} className={`salon-line${max <= 0 ? ' is-void' : ''}`}>
                  <span className="salon-qty" role="group" aria-label={`A pagar de ${l.name}`}>
                    <button type="button" className="btn btn-ghost icon-btn" aria-label={`Uno menos de ${l.name}`} disabled={q <= 0} onClick={() => setSel((x) => ({ ...x, [l.id]: q - 1 }))}><Minus size={16} /></button>
                    <b className="num">{q}</b>
                    <button type="button" className="btn btn-ghost icon-btn" aria-label={`Uno más de ${l.name}`} disabled={q >= max} onClick={() => setSel((x) => ({ ...x, [l.id]: q + 1 }))}><Plus size={16} /></button>
                  </span>
                  <span className="grow salon-line-text"><span className="salon-line-name">{l.name}</span><span className="small muted">{max <= 0 ? 'Pagado' : `quedan ${max} × ${fmtMoney(l.price)}`}</span></span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="stack" aria-labelledby="charge-pay" style={{ marginTop: 14 }}>
        <h3 id="charge-pay" className="salon-sub">Pago</h3>
        {payments.map((p, i) => (
          <div key={i} className="charge-pay">
            <label className="charge-field"><span>Medio</span>
              <Select aria-label={`Medio de pago ${i + 1}`} value={p.method} onChange={(e) => {
                const m = e.target.value as SalePaymentMethod;
                setPay(i, { method: m, received: undefined, accountId: undefined, accountName: undefined, note: undefined });
                if (m === 'invitacion' && payments.length === 1) setMode('no');
              }}>
                {METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
              </Select>
            </label>
            {p.method === 'cuenta_corriente' && (newAccount?.row === i ? (
              <span className="charge-field"><span>Cliente nuevo</span>
                <span className="row" style={{ gap: 6 }}>
                  <Input aria-label="Nombre del cliente nuevo" autoFocus value={newAccount.name} onChange={(e) => setNewAccount({ row: i, name: e.target.value })} placeholder="Ej.: ALADES" />
                  <button type="button" className="btn btn-sm" onClick={() => void run(async () => {
                    const a = await saveAccount({ name: newAccount.name });
                    setPay(i, { accountId: a.id, accountName: a.name });
                    setNewAccount(null);
                  })}>Agregar</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewAccount(null)}>Cancelar</button>
                </span>
              </span>
            ) : (
              <label className="charge-field"><span>Cliente</span>
                <Select aria-label={`Cliente de cuenta corriente ${i + 1}`} value={p.accountId ?? ''} onChange={(e) => {
                  const id = e.target.value;
                  if (id === NEW_ACCOUNT) return setNewAccount({ row: i, name: '' });
                  setPay(i, { accountId: id || undefined, accountName: accounts.find((a) => a.id === id)?.name });
                }}>
                  <option value="">Elegí el cliente…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  <option value={NEW_ACCOUNT}>+ Cliente nuevo…</option>
                </Select>
              </label>
            ))}
            {p.method === 'invitacion' && (
              <label className="charge-field"><span>Motivo</span>
                <Input aria-label={`Motivo de la invitación ${i + 1}`} value={p.note ?? ''} onChange={(e) => setPay(i, { note: e.target.value })} placeholder="Ej.: invitación de la casa, consumo personal" />
              </label>
            )}
            <label className="charge-field"><span>Importe</span><NumberInput aria-label={`Importe ${i + 1}`} value={p.amount} onChange={(v) => setPay(i, { amount: v ?? 0 })} min={0} /></label>
            {p.method === 'efectivo' && <label className="charge-field"><span>Recibido (para el vuelto)</span><NumberInput aria-label="Efectivo recibido" placeholder="Opcional" value={p.received} onChange={(v) => setPay(i, { received: v })} min={0} /></label>}
            {payments.length > 1 && <button type="button" className="btn btn-ghost icon-btn" aria-label={`Quitar pago ${i + 1}`} onClick={() => setPayments((xs) => xs.filter((_, j) => j !== i))}><Trash2 size={18} /></button>}
          </div>
        ))}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn btn-sm" onClick={addPay}><Plus size={16} aria-hidden /> Otro medio de pago</button>
          <span className="small">{payProblems.length ? <b style={{ color: 'var(--crit)' }}>{payProblems[0]}</b> : Math.abs(left) > 0.009 ? <b style={{ color: 'var(--crit)' }}>{left > 0 ? `Faltan ${fmtMoney(left)}` : `Sobran ${fmtMoney(-left)}`}</b> : change ? <b>Vuelto: {fmtMoney(change)}</b> : 'Cubierto'}</span>
        </div>
        <div className="charge-tip">
          <label className="charge-field"><span>Propina (opcional)</span><NumberInput aria-label="Propina" value={tip} onChange={setTip} min={0} placeholder="0" /></label>
          <div className="group-chips">
            {[10, 15].map((pc) => <button key={pc} type="button" className="group-chip" onClick={() => setTip(round2(amount * pc / 100))}>{pc}%</button>)}
            {tip ? <button type="button" className="group-chip" onClick={() => setTip(undefined)}>Sin propina</button> : null}
          </div>
          {tip ? (
            <label className="charge-field"><span>Propina en</span>
              <Select aria-label="Medio de la propina" value={tipInfo?.method ?? 'efectivo'} onChange={(e) => setTipMethod(e.target.value as SalePaymentMethod)}>
                {TIP_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
              </Select>
            </label>
          ) : null}
        </div>
      </section>

      <section className="stack" aria-labelledby="charge-inv" style={{ marginTop: 14 }}>
        <h3 id="charge-inv" className="salon-sub">Factura{split !== 'todo' ? ' de esta parte' : ''}</h3>
        {billing ? (<>
          <Segmented<InvoiceMode> label="Factura" value={mode} onChange={setMode}
            options={[{ value: 'cf', label: 'Consumidor final' }, { value: 'datos', label: 'Con datos (CUIT/DNI)' }, { value: 'no', label: 'Sin factura por ahora' }]} />
          {mode === 'datos' && <ReceptorForm rec={rec} setRec={setRec} recent={recent} letra={letra} />}
          {mode !== 'no' && <p className="small muted" style={{ margin: 0 }}>Se emite <b>Factura {letra}</b> {f.ambiente === 'homologacion' ? 'de PRUEBA (homologación)' : 'electrónica'} por {fmtMoney(amount)} en el punto de venta {f.ptoVta}. La propina no se factura.</p>}
          {mode === 'no' && <p className="small muted" style={{ margin: 0 }}>Se cobra y queda en “Sin facturar” para emitir la factura después (por ejemplo, si ARCA no anda).</p>}
          {cfTooBig && <p className="small" style={{ color: 'var(--crit)', margin: 0 }}>Desde {fmtMoney(CF_ID_THRESHOLD)} hay que identificar al cliente: elegí “Con datos”.</p>}
          {mode === 'datos' && problems.length > payProblems.length && <p className="small" style={{ color: 'var(--crit)', margin: 0 }}>{problems.slice(payProblems.length).join(' ')}</p>}
        </>) : (
          <p className="small muted" style={{ margin: 0 }}>{f.enabled ? 'Falta completar la Configuración fiscal para facturar acá.' : 'Se registra el cobro sin factura electrónica. Para facturar con ARCA, activala en Configuración del salón → Facturación electrónica.'}</p>
        )}
      </section>
    </Modal>
  );
}

export function ReceptorForm({ rec, setRec, recent, letra }: { rec: FiscalReceptor; setRec: (r: FiscalReceptor) => void; recent: FiscalReceptor[]; letra: string }) {
  const set = (p: Partial<FiscalReceptor>) => setRec({ ...rec, ...p });
  const pick = (nro: string) => {
    const r = recent.find((x) => x.docNro === nro.replace(/\D/g, ''));
    if (r) setRec({ ...r });
  };
  return (
    <div className="stack charge-rec">
      <div className="form-grid cols-2">
        <Field label="Documento">
          <Select value={rec.docTipo} onChange={(e) => { const t = Number(e.target.value) as DocTipo; set({ docTipo: t, condicionIva: t === 96 ? 5 : rec.condicionIva }); }}>
            {([80, 96, 86] as DocTipo[]).map((t) => <option key={t} value={t}>{DOC_TIPO_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Número">
          <Input list="charge-recent" value={rec.docNro} inputMode="numeric" onChange={(e) => { set({ docNro: e.target.value }); pick(e.target.value); }} placeholder={rec.docTipo === 96 ? '30111222' : '30-12345678-9'} />
        </Field>
        <Field label="Nombre o razón social"><Input value={rec.nombre ?? ''} onChange={(e) => set({ nombre: e.target.value })} /></Field>
        <Field label="Condición frente al IVA">
          <Select value={rec.condicionIva} onChange={(e) => set({ condicionIva: Number(e.target.value) })}>
            {Object.entries(COND_IVA).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </Field>
        <Field label="Domicilio (opcional)"><Input value={rec.domicilio ?? ''} onChange={(e) => set({ domicilio: e.target.value })} /></Field>
      </div>
      <datalist id="charge-recent">{recent.map((r) => <option key={r.docNro} value={r.docNro}>{r.nombre}</option>)}</datalist>
      <p className="small muted" style={{ margin: 0 }}>Corresponde <b>Factura {letra}</b>.</p>
    </div>
  );
}


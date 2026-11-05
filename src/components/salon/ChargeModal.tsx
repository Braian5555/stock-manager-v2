import { CheckCircle2, Plus, Printer, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DocTipo, FiscalDoc, FiscalReceptor, Payment, SalePaymentMethod, TableTicket } from '../../models';
import {
  CBTE_NAME, COND_IVA, CONSUMIDOR_FINAL, CF_ID_THRESHOLD, DOC_TIPO_LABEL, PAYMENT_LABEL, chargeTicket, docNumber, fiscalOf, fiscalReady, invoiceLater, issue,
  letterFor, receptorProblems, recentReceptors, ymdToDate,
} from '../../services/fiscalService';
import { fiscalTicketHtml, printHtml } from '../../services/printService';
import { closeTicket } from '../../services/salonService';
import { useFeedback } from '../../store/feedback';
import { useSettings } from '../../store/settings';
import { fmtMoney } from '../../utils/format';
import { Field, Input, NumberInput, Segmented, Select } from '../ui';
import { Modal } from '../ui/Modal';

type InvoiceMode = 'cf' | 'datos' | 'no';
const METHODS = Object.keys(PAYMENT_LABEL) as SalePaymentMethod[];
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cobrar la mesa: medios de pago (se puede dividir), datos del cliente y factura electrónica.
 * Cuando ARCA autoriza, se puede imprimir el ticket fiscal. Si ARCA no contesta, la mesa se cierra
 * igual (ya se cobró) y el comprobante queda para reintentar en Comprobantes.
 */
export function ChargeModal({ ticket, onClose }: { ticket: TableTicket; onClose: (closed: boolean) => void }) {
  const settings = useSettings();
  const f = fiscalOf(settings);
  const billing = fiscalReady(f);
  const { run, notify } = useFeedback();
  const [payments, setPayments] = useState<Payment[]>([{ method: 'efectivo', amount: ticket.total }]);
  const [mode, setMode] = useState<InvoiceMode>(billing ? 'cf' : 'no');
  const [rec, setRec] = useState<FiscalReceptor>({ docTipo: 80, docNro: '', condicionIva: 1 });
  const [recent, setRecent] = useState<FiscalReceptor[]>([]);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<FiscalDoc | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => { if (billing) void recentReceptors().then(setRecent); }, [billing]);

  const paid = round2(payments.reduce((s, p) => s + (p.amount || 0), 0));
  const left = round2(ticket.total - paid);
  const cash = payments.find((p) => p.method === 'efectivo');
  const change = cash?.received && cash.received > cash.amount ? round2(cash.received - cash.amount) : 0;
  const receptor: FiscalReceptor = mode === 'datos' ? rec : CONSUMIDOR_FINAL;
  const letra = letterFor(f, receptor.condicionIva);
  const problems = useMemo(() => (mode === 'no' ? [] : receptorProblems(receptor, letra, ticket.total)), [mode, receptor, letra, ticket.total]);
  const cfTooBig = mode === 'cf' && ticket.total >= CF_ID_THRESHOLD;

  const setPay = (i: number, p: Partial<Payment>) => setPayments((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const addPay = () => setPayments((xs) => [...xs, { method: xs.some((x) => x.method === 'debito') ? 'transferencia' : 'debito', amount: Math.max(0, left) }]);

  const submit = async () => {
    if (Math.abs(left) > 0.009) return notify(left > 0 ? `Faltan ${fmtMoney(left)} para completar el total.` : `Los pagos superan el total por ${fmtMoney(-left)}.`, { tone: 'error' });
    if (problems.length) return notify(problems.join(' '), { tone: 'error' });
    setBusy(true);
    try {
      const clean = payments.filter((p) => p.amount > 0).map((p) => (p.method === 'efectivo' && p.received ? p : { method: p.method, amount: p.amount }));
      const r = await run(() => chargeTicket(ticket.id, { payments: clean, invoice: mode === 'no' ? false : { receptor } }));
      if (!r) return;
      await run(() => closeTicket(ticket.id, { maxirest: !billing }));
      setClosed(true);
      if (r.doc) setDoc(r.doc);
      else { notify(`Mesa ${ticket.tableName} cobrada y cerrada`); onClose(true); }
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const next = doc.status === 'rechazada' || (doc.status === 'error' && !doc.attempt)
        ? await run(() => invoiceLater(ticket.id, receptor))
        : await run(() => issue(doc.id));
      if (next) setDoc(next);
    } finally {
      setBusy(false);
    }
  };

  const print = async (d: FiscalDoc) => run(async () => printHtml(await fiscalTicketHtml(d, f.pie)));

  // ── Resultado de la factura ──
  if (doc) {
    const ok = doc.status === 'autorizada';
    const canFix = doc.status === 'rechazada' || (doc.status === 'error' && !doc.attempt);
    return (
      <Modal open title={`Mesa ${ticket.tableName}`} onClose={() => onClose(closed)}
        footer={<>
          {!ok && <button type="button" className="btn" disabled={busy} onClick={() => void retry()}><RotateCcw size={18} aria-hidden /> {busy ? 'Enviando…' : canFix ? 'Volver a emitir' : 'Reintentar'}</button>}
          {ok && <button type="button" className="btn" onClick={() => void print(doc)}><Printer size={18} aria-hidden /> Imprimir ticket</button>}
          <button type="button" className="btn btn-primary" onClick={() => onClose(closed)}>Listo</button>
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
              <p className="small muted">La mesa ya quedó cobrada y cerrada. {canFix ? 'Corregí los datos del cliente y volvé a emitir,' : 'Podés reintentar ahora'} o más tarde desde Comprobantes. {doc.status === 'incierta' ? 'Al reintentar se consulta en ARCA antes de pedir otra: no se duplica.' : ''}</p>
            </div>
          </div>
        )}
        {canFix && <ReceptorForm rec={rec} setRec={setRec} recent={recent} letra={letterFor(f, rec.condicionIva)} />}
      </Modal>
    );
  }

  // ── Cobro ──
  return (
    <Modal open wide title={`Cobrar mesa ${ticket.tableName}`} onClose={() => onClose(false)}
      footer={<>
        <div className="salon-total"><span>Total</span><b className="num">{fmtMoney(ticket.total)}</b></div>
        <button type="button" className="btn btn-primary" disabled={busy || Math.abs(left) > 0.009 || problems.length > 0} onClick={() => void submit()}>
          {busy ? (mode === 'no' ? 'Cobrando…' : 'Facturando…') : mode === 'no' ? `Cobrar ${fmtMoney(ticket.total)} y cerrar` : `Cobrar y emitir Factura ${letra}`}
        </button>
      </>}>
      <section className="stack" aria-labelledby="charge-pay">
        <h3 id="charge-pay" className="salon-sub" style={{ marginTop: 0 }}>Pago</h3>
        {payments.map((p, i) => (
          <div key={i} className="charge-pay">
            <label className="charge-field"><span>Medio</span>
              <Select aria-label={`Medio de pago ${i + 1}`} value={p.method} onChange={(e) => setPay(i, { method: e.target.value as SalePaymentMethod, received: undefined })}>
                {METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
              </Select>
            </label>
            <label className="charge-field"><span>Importe</span><NumberInput aria-label={`Importe ${i + 1}`} value={p.amount} onChange={(v) => setPay(i, { amount: v ?? 0 })} min={0} /></label>
            {p.method === 'efectivo' && <label className="charge-field"><span>Recibido (para el vuelto)</span><NumberInput aria-label="Efectivo recibido" placeholder="Opcional" value={p.received} onChange={(v) => setPay(i, { received: v })} min={0} /></label>}
            {payments.length > 1 && <button type="button" className="btn btn-ghost icon-btn" aria-label={`Quitar pago ${i + 1}`} onClick={() => setPayments((xs) => xs.filter((_, j) => j !== i))}><Trash2 size={18} /></button>}
          </div>
        ))}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn btn-sm" onClick={addPay}><Plus size={16} aria-hidden /> Dividir el pago</button>
          <span className="small">{Math.abs(left) > 0.009 ? <b style={{ color: 'var(--crit)' }}>{left > 0 ? `Faltan ${fmtMoney(left)}` : `Sobran ${fmtMoney(-left)}`}</b> : change ? <b>Vuelto: {fmtMoney(change)}</b> : 'Total cubierto'}</span>
        </div>
      </section>

      <section className="stack" aria-labelledby="charge-inv" style={{ marginTop: 14 }}>
        <h3 id="charge-inv" className="salon-sub">Factura</h3>
        {billing ? (<>
          <Segmented<InvoiceMode> label="Factura" value={mode} onChange={setMode}
            options={[{ value: 'cf', label: 'Consumidor final' }, { value: 'datos', label: 'Con datos (CUIT/DNI)' }, { value: 'no', label: 'Sin factura por ahora' }]} />
          {mode === 'datos' && <ReceptorForm rec={rec} setRec={setRec} recent={recent} letra={letra} />}
          {mode !== 'no' && <p className="small muted" style={{ margin: 0 }}>Se emite <b>Factura {letra}</b> {f.ambiente === 'homologacion' ? 'de PRUEBA (homologación)' : 'electrónica'} en el punto de venta {f.ptoVta}.</p>}
          {mode === 'no' && <p className="small muted" style={{ margin: 0 }}>La mesa se cobra y queda en “Sin facturar” para emitir la factura después (por ejemplo, si ARCA no anda).</p>}
          {cfTooBig && <p className="small" style={{ color: 'var(--crit)', margin: 0 }}>Desde {fmtMoney(CF_ID_THRESHOLD)} hay que identificar al cliente: elegí “Con datos”.</p>}
          {mode === 'datos' && problems.length > 0 && <p className="small" style={{ color: 'var(--crit)', margin: 0 }}>{problems.join(' ')}</p>}
        </>) : (
          <p className="small muted" style={{ margin: 0 }}>{f.enabled ? 'Falta completar la Configuración fiscal para facturar acá.' : 'La factura se hace en Maxirest (la facturación electrónica de Stock Manager está apagada).'}</p>
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


import { useLiveQuery } from 'dexie-react-hooks';
import { FileSpreadsheet, FileText, Printer, Receipt, RotateCcw, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ivaBook } from '../services/closingService';
import { Link } from 'react-router';
import { db } from '../database/db';
import { EMPTY } from '../hooks/useData';
import type { FiscalDoc, FiscalLine, FiscalLogEntry, FiscalReceptor, FiscalStatus, TableTicket } from '../models';
import {
  CBTE_NAME, CONSUMIDOR_FINAL, DOC_TIPO_LABEL, PAYMENT_LABEL, docNumber, docPlace, fiscalOf, fiscalReady, fmtCuit, invoiceLater, issue, letterFor, noteFor, receptorProblems, recentReceptors, verifyInArca, ymdToDate,
} from '../services/fiscalService';
import { fiscalTicketHtml, printHtml, ticketBusiness } from '../services/printService';
import { ticketLabel } from '../services/salonService';
import { useFeedback } from '../store/feedback';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { Badge, EmptyState, Field, Input, NumberInput, PageHeader, Segmented } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ReceptorForm } from '../components/salon/ChargeModal';
import { CloudRulesNote } from '../components/salon/CloudRulesNote';
import { fmtDateTime, fmtMoney, matches } from '../utils/format';

type Tab = 'emitidos' | 'resolver' | 'sinfactura' | 'libro' | 'registro';
type Period = '1' | '7' | '30' | 'todo';
const STATUS_LABEL: Record<FiscalStatus, string> = { borrador: 'Sin enviar', enviando: 'Enviando', autorizada: 'Autorizada', rechazada: 'Rechazada', incierta: 'Sin confirmar', error: 'Con error' };
const STATUS_TONE: Record<FiscalStatus, string> = { borrador: '', enviando: 'info', autorizada: 'ok', rechazada: 'danger', incierta: 'warn', error: 'danger' };
const PENDING: FiscalStatus[] = ['borrador', 'enviando', 'incierta', 'error', 'rechazada'];

const sinceFor = (p: Period) => {
  if (p === 'todo') return '';
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (Number(p) - 1));
  return d.toISOString();
};

/** Comprobantes: facturas y notas emitidas, lo que falta resolver, mesas sin facturar y el registro de ARCA. */
export function FiscalDocsPage() {
  const settings = useSettings();
  const f = fiscalOf(settings);
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('emitidos');
  const docs = (useLiveQuery(() => db.fiscalDocs.orderBy('createdAt').reverse().toArray(), []) ?? EMPTY) as FiscalDoc[];
  const unbilledTickets = (useLiveQuery(() => db.tickets.filter((t) => !!t.fiscalPending && t.status !== 'anulada').toArray(), []) ?? EMPTY) as TableTicket[];
  const unbilled = unbilledRows(unbilledTickets);
  const pending = docs.filter((d) => PENDING.includes(d.status) && !(d.status === 'rechazada' && docs.some((x) => x.ticketId && x.ticketId === d.ticketId && x.status === 'autorizada')));
  const [open, setOpen] = useState<string | null>(null);

  const tabs: { value: Tab; label: string }[] = [
    { value: 'emitidos', label: 'Emitidos' },
    { value: 'resolver', label: `Para resolver${pending.length ? ` (${pending.length})` : ''}` },
    { value: 'sinfactura', label: `Sin facturar${unbilled.length ? ` (${unbilled.length})` : ''}` },
    ...(can('admin') || can('billing') ? [{ value: 'libro' as Tab, label: 'Libro IVA' }] : []),
    ...(can('admin') ? [{ value: 'registro' as Tab, label: 'Registro ARCA' }] : []),
  ];

  return (
    <div className="salon">
      <PageHeader title="Comprobantes" subtitle={f.enabled ? `Factura electrónica ARCA · punto de venta ${f.ptoVta || '—'} · ${f.ambiente === 'produccion' ? 'producción' : 'homologación (pruebas)'}` : 'Factura electrónica ARCA'}
        actions={<Segmented<Tab> label="Ver comprobantes" value={tab} onChange={setTab} options={tabs} />} />
      <CloudRulesNote />
      {!fiscalReady(f) && (
        <div className="alert alert-warn" role="note"><TriangleAlert size={18} aria-hidden />
          <span>La facturación electrónica {f.enabled ? 'tiene datos sin completar' : 'está apagada'}. {can('admin') ? <Link to="/salon/configuracion/facturacion">Abrir la configuración de facturación</Link> : 'Pedile a un administrador que la configure.'}</span>
        </div>
      )}
      {f.enabled && f.ambiente === 'homologacion' && <div className="alert alert-info" role="note"><ShieldCheck size={18} aria-hidden /><span>Homologación: los comprobantes son de prueba y no tienen validez fiscal.</span></div>}
      {tab === 'emitidos' && <Issued docs={docs} onOpen={setOpen} />}
      {tab === 'resolver' && <PendingList docs={pending} onOpen={setOpen} />}
      {tab === 'sinfactura' && <Unbilled tickets={unbilled} />}
      {tab === 'libro' && <IvaBookTab docs={docs} test={f.ambiente === 'homologacion'} />}
      {tab === 'registro' && <ArcaLog />}
      {open && <DocDetail id={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

function DocRow({ d, onOpen }: { d: FiscalDoc; onOpen: (id: string) => void }) {
  return (
    <li className="list-item">
      <button type="button" className="list-btn grow" onClick={() => onOpen(d.id)}>
        <span className="list-title">{CBTE_NAME[d.cbteTipo]} {d.nro ? docNumber(d) : `${String(d.ptoVta).padStart(5, '0')}-········`}</span>
        <span className="list-sub">{d.receptor.docTipo === 99 ? 'Consumidor final' : `${d.receptor.nombre ?? ''} · ${DOC_TIPO_LABEL[d.receptor.docTipo]} ${d.receptor.docNro}`}{d.tableName ? ` · ${docPlace(d)}` : ''} · {fmtDateTime(d.authorizedAt ?? d.createdAt)}</span>
      </button>
      <span className="salon-today-right">
        <b className="num">{d.kind === 'nc' ? '−' : ''}{fmtMoney(d.impTotal)}</b>
        <span className="row" style={{ gap: 4 }}>{d.ambiente === 'homologacion' && <Badge tone="info">Prueba</Badge>}<Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge></span>
      </span>
    </li>
  );
}

function Issued({ docs, onOpen }: { docs: FiscalDoc[]; onOpen: (id: string) => void }) {
  const [period, setPeriod] = useState<Period>('1');
  const [q, setQ] = useState('');
  const since = sinceFor(period);
  const list = docs.filter((d) => d.status === 'autorizada' && (!since || (d.authorizedAt ?? d.createdAt) >= since)
    && (!q.trim() || matches(`${d.receptor.nombre ?? ''} ${d.receptor.docNro} ${d.nro ?? ''} ${d.tableName ?? ''} ${d.cae ?? ''}`, q)));
  const total = list.reduce((s, d) => s + (d.kind === 'nc' ? -d.impTotal : d.impTotal), 0);
  const byMethod = new Map<string, number>();
  for (const d of list) for (const p of d.payments ?? []) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
  return (<>
    <div className="salon-bar">
      <Segmented<Period> label="Período" value={period} onChange={setPeriod} options={[{ value: '1', label: 'Hoy' }, { value: '7', label: '7 días' }, { value: '30', label: '30 días' }, { value: 'todo', label: 'Todo' }]} />
      <label className="production-search salon-search">
        <Search size={20} aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, número o CAE" aria-label="Buscar comprobante" />
      </label>
    </div>
    <div className="salon-stats">
      <div className="salon-stat"><span className="num">{fmtMoney(total)}</span><span>facturado (neto de notas de crédito)</span></div>
      <div className="salon-stat"><span className="num">{list.length}</span><span>comprobantes</span></div>
      {[...byMethod.entries()].slice(0, 2).map(([m, v]) => <div key={m} className="salon-stat"><span className="num">{fmtMoney(v)}</span><span>{PAYMENT_LABEL[m as keyof typeof PAYMENT_LABEL]}</span></div>)}
    </div>
    {list.length === 0 ? (
      <div className="card"><EmptyState icon={<Receipt size={40} />} title="No hay comprobantes en este período">Las facturas que se emiten al cobrar las mesas aparecen acá.</EmptyState></div>
    ) : <section className="card" aria-label="Comprobantes emitidos"><ul className="list">{list.map((d) => <DocRow key={d.id} d={d} onOpen={onOpen} />)}</ul></section>}
  </>);
}

function PendingList({ docs, onOpen }: { docs: FiscalDoc[]; onOpen: (id: string) => void }) {
  const { run } = useFeedback();
  const [busy, setBusy] = useState('');
  if (!docs.length) return <div className="card"><EmptyState icon={<ShieldCheck size={40} />} title="Nada para resolver">Todos los comprobantes están autorizados por ARCA.</EmptyState></div>;
  return (
    <section className="card" aria-label="Comprobantes para resolver">
      <ul className="list">
        {docs.map((d) => (
          <li key={d.id} className="list-item fiscal-pending">
            <button type="button" className="list-btn grow" onClick={() => onOpen(d.id)}>
              <span className="list-title">{CBTE_NAME[d.cbteTipo]} · {fmtMoney(d.impTotal)}{d.tableName ? ` · ${docPlace(d)}` : ''}</span>
              <span className="list-sub">{d.message ?? STATUS_LABEL[d.status]}</span>
            </button>
            <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
            {d.status !== 'rechazada' && (
              <button type="button" className="btn btn-sm" disabled={busy === d.id} onClick={() => { setBusy(d.id); void run(() => issue(d.id)).finally(() => setBusy('')); }}>
                <RotateCcw size={16} aria-hidden /> {busy === d.id ? 'Enviando…' : 'Reintentar'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface UnbilledRow { ticket: TableTicket; chargeId?: string; amount: number; at?: string; methods: string; label?: string }

/** Cobros sin factura (uno por parte si la cuenta se dividió). */
function unbilledRows(tickets: TableTicket[]): UnbilledRow[] {
  const rows: UnbilledRow[] = [];
  for (const t of tickets) {
    const pend = (t.charges ?? []).filter((c) => c.fiscalPending);
    if (!(t.charges ?? []).length) rows.push({ ticket: t, amount: t.total, at: t.paidAt ?? t.closedAt, methods: (t.payments ?? []).map((p) => PAYMENT_LABEL[p.method]).join(' + ') });
    for (const c of pend) rows.push({ ticket: t, chargeId: c.id, amount: c.amount, at: c.at, methods: c.payments.map((p) => PAYMENT_LABEL[p.method]).join(' + '), label: c.label });
  }
  return rows.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}

function Unbilled({ tickets: rows }: { tickets: UnbilledRow[] }) {
  const [sel, setSel] = useState<UnbilledRow | null>(null);
  if (!rows.length) return <div className="card"><EmptyState icon={<Receipt size={40} />} title="No hay cobros sin facturar">Lo que se cobra con “Sin factura por ahora” queda acá para facturarlo después.</EmptyState></div>;
  return (<>
    <section className="card" aria-label="Cobros sin facturar">
      <ul className="list">
        {rows.map((r) => (
          <li key={r.chargeId ?? r.ticket.id} className="list-item">
            <div className="grow"><div className="list-title">{ticketLabel(r.ticket)} · #{r.ticket.number}{r.label ? ` · ${r.label}` : ''}</div><div className="list-sub">Cobrado {fmtDateTime(r.at)} · {r.methods}</div></div>
            <b className="num">{fmtMoney(r.amount)}</b>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setSel(r)}>Facturar</button>
          </li>
        ))}
      </ul>
    </section>
    {sel && <InvoiceLaterModal ticket={sel.ticket} chargeId={sel.chargeId} amount={sel.amount} onClose={() => setSel(null)} />}
  </>);
}

function InvoiceLaterModal({ ticket, chargeId, amount, onClose }: { ticket: TableTicket; chargeId?: string; amount: number; onClose: () => void }) {
  const f = fiscalOf(useSettings());
  const { run, notify } = useFeedback();
  const [cf, setCf] = useState(true);
  const [rec, setRec] = useState<FiscalReceptor>({ docTipo: 80, docNro: '', condicionIva: 1 });
  const [recent, setRecent] = useState<FiscalReceptor[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void recentReceptors().then(setRecent); }, []);
  const receptor = cf ? CONSUMIDOR_FINAL : rec;
  const letra = letterFor(f, receptor.condicionIva);
  const problems = receptorProblems(receptor, letra, amount);
  const go = async () => {
    setBusy(true);
    const d = await run(() => invoiceLater(ticket.id, receptor, chargeId));
    setBusy(false);
    if (!d) return;
    if (d.status === 'autorizada') { notify(`${CBTE_NAME[d.cbteTipo]} ${docNumber(d)} autorizada`); onClose(); }
    else notify(d.message ?? 'No se pudo emitir: quedó en “Para resolver”.', { tone: 'error' });
  };
  return (
    <Modal open title={`Facturar · ${ticketLabel(ticket)}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" disabled={busy || problems.length > 0} onClick={() => void go()}>{busy ? 'Facturando…' : `Emitir Factura ${letra} · ${fmtMoney(amount)}`}</button></>}>
      <Segmented<'cf' | 'datos'> label="Cliente" value={cf ? 'cf' : 'datos'} onChange={(v) => setCf(v === 'cf')} options={[{ value: 'cf', label: 'Consumidor final' }, { value: 'datos', label: 'Con datos (CUIT/DNI)' }]} />
      {!cf && <ReceptorForm rec={rec} setRec={setRec} recent={recent} letra={letra} />}
      {problems.length > 0 && <p className="small" style={{ color: 'var(--crit)' }}>{problems.join(' ')}</p>}
    </Modal>
  );
}

// ───────────── detalle de un comprobante ─────────────

function DocDetail({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { run, notify } = useFeedback();
  const { can } = useSession();
  const settings = useSettings();
  const f = fiscalOf(settings);
  const d = useLiveQuery(() => db.fiscalDocs.get(id), [id]);
  const notes = (useLiveQuery(() => db.fiscalDocs.filter((x) => x.asociado?.docId === id).toArray(), [id]) ?? EMPTY) as FiscalDoc[];
  const log = (useLiveQuery(() => db.fiscalLog.where('docId').equals(id).sortBy('at'), [id]) ?? EMPTY) as FiscalLogEntry[];
  const [busy, setBusy] = useState(false);
  const [noteKind, setNoteKind] = useState<'nc' | 'nd' | null>(null);
  if (!d) return null;
  const ok = d.status === 'autorizada';
  const credited = notes.filter((n) => n.kind === 'nc' && n.status === 'autorizada').reduce((s, n) => s + n.impTotal, 0);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await run(fn); } finally { setBusy(false); } };
  const verify = () => act(async () => {
    const r = await verifyInArca(d);
    notify(r.matches ? 'Verificado: ARCA tiene este comprobante con el mismo CAE e importe.' : r.exists ? 'ARCA tiene ese número, pero con otros datos. Revisalo.' : 'ARCA no encuentra ese comprobante.', { tone: r.matches ? 'info' : 'error' });
  });
  return (
    <Modal open wide title={`${CBTE_NAME[d.cbteTipo]} ${d.nro ? docNumber(d) : ''}`} onClose={onClose}
      footer={<>
        {ok && <button type="button" className="btn" onClick={() => void act(async () => printHtml(await fiscalTicketHtml(d, f.pie, settings.ticketHeader?.trim() ? ticketBusiness(settings) : undefined)))}><Printer size={18} aria-hidden /> Imprimir</button>}
        {ok && <button type="button" className="btn" disabled={busy} onClick={() => void verify()}><ShieldCheck size={18} aria-hidden /> Verificar en ARCA</button>}
        {!ok && d.status !== 'rechazada' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(() => issue(d.id))}><RotateCcw size={18} aria-hidden /> {busy ? 'Enviando…' : 'Reintentar'}</button>}
        {ok && d.kind === 'factura' && credited < d.impTotal - 0.009 && <button type="button" className="btn" onClick={() => setNoteKind('nc')}>Nota de crédito</button>}
        {ok && d.kind === 'factura' && <button type="button" className="btn btn-ghost" onClick={() => setNoteKind('nd')}>Nota de débito</button>}
      </>}>
      <div className="fiscal-detail">
        <div className="row wrap" style={{ gap: 6 }}>
          <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
          {d.ambiente === 'homologacion' && <Badge tone="info">Homologación (prueba)</Badge>}
          {credited > 0 && <Badge tone="warn">{credited >= d.impTotal - 0.009 ? 'Anulada con nota de crédito' : `Nota de crédito por ${fmtMoney(credited)}`}</Badge>}
        </div>
        {d.message && <p className="small" style={{ color: ok ? 'var(--text-2)' : 'var(--crit)' }}>{d.message}</p>}
        <dl className="fiscal-dl">
          <dt>Cliente</dt><dd>{d.receptor.docTipo === 99 ? 'Consumidor final' : `${d.receptor.nombre ?? ''} · ${DOC_TIPO_LABEL[d.receptor.docTipo]} ${d.receptor.docTipo === 80 || d.receptor.docTipo === 86 ? fmtCuit(d.receptor.docNro) : d.receptor.docNro}`}</dd>
          <dt>Fecha</dt><dd>{d.fecha ? ymdToDate(d.fecha) : '—'}{d.tableName ? ` · ${docPlace(d)}` : ''}{d.createdBy ? ` · ${d.createdBy.name}` : ''}</dd>
          {ok && <><dt>CAE</dt><dd className="num">{d.cae} (vence {ymdToDate(d.caeVto)})</dd></>}
          {d.asociado && <><dt>Asociado a</dt><dd>{d.asociado.docId ? <button type="button" className="link-btn" onClick={() => onOpen(d.asociado!.docId!)}>{CBTE_NAME[d.asociado.cbteTipo]} {String(d.asociado.ptoVta).padStart(5, '0')}-{String(d.asociado.nro).padStart(8, '0')}</button> : `${CBTE_NAME[d.asociado.cbteTipo]} ${d.asociado.nro}`}</dd></>}
          {d.attempt && !ok && <><dt>Número reservado</dt><dd className="num">{d.attempt.nro} (se consulta en ARCA antes de pedir otro)</dd></>}
        </dl>
        <ul className="salon-lines">
          {d.lines.map((l, i) => (
            <li key={i} className="salon-line"><b className="salon-qty-fixed num">{l.qty}×</b><span className="grow salon-line-text"><span className="salon-line-name">{l.name}</span><span className="small muted">{fmtMoney(l.unitPrice)} · IVA {String(l.iva).replace('.', ',')}%</span></span><span className="num salon-line-price">{fmtMoney(l.total)}</span></li>
          ))}
        </ul>
        {d.letra !== 'C' && d.iva.map((a) => <p key={a.id} className="small muted fiscal-iva">Neto {String(a.rate).replace('.', ',')}% {fmtMoney(a.baseImp)} · IVA {fmtMoney(a.importe)}</p>)}
        <div className="salon-total"><span>Total</span><b className="num">{fmtMoney(d.impTotal)}</b></div>
        {!!d.obs?.length && <p className="small muted">Observaciones de ARCA: {d.obs.map((o) => `${o.code} ${o.msg}`).join(' · ')}</p>}
        {notes.length > 0 && (
          <div><h3 className="salon-sub">Notas asociadas</h3><ul className="list">{notes.map((n) => <DocRow key={n.id} d={n} onOpen={onOpen} />)}</ul></div>
        )}
        {can('admin') && log.length > 0 && (
          <details className="fiscal-log"><summary>Registro de ARCA ({log.length})</summary><LogList entries={log} /></details>
        )}
      </div>
      {noteKind && <NoteModal doc={d} kind={noteKind} remaining={Math.round((d.impTotal - credited) * 100) / 100} onClose={() => setNoteKind(null)}
        onDone={async (n) => {
          setNoteKind(null);
          if (n.status === 'autorizada') notify(`${CBTE_NAME[n.cbteTipo]} ${docNumber(n)} autorizada`);
          else notify(n.message ?? 'La nota quedó para resolver.', { tone: 'error' });
        }} />}
    </Modal>
  );
}

function NoteModal({ doc, kind, remaining, onClose, onDone }: { doc: FiscalDoc; kind: 'nc' | 'nd'; remaining: number; onClose: () => void; onDone: (d: FiscalDoc) => void }) {
  const { run } = useFeedback();
  const [qty, setQty] = useState<number[]>(doc.lines.map((l) => l.qty));
  const [amount, setAmount] = useState<number | undefined>();
  const [concept, setConcept] = useState('');
  const [busy, setBusy] = useState(false);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lines: FiscalLine[] = kind === 'nc'
    ? doc.lines.map((l, i) => ({ ...l, qty: qty[i] ?? 0, total: r2((qty[i] ?? 0) * l.unitPrice) })).filter((l) => l.qty > 0)
    : amount ? [{ name: concept.trim() || 'Ajuste', qty: 1, unitPrice: amount, iva: doc.lines[0]?.iva ?? 21, total: r2(amount) }] : [];
  const total = r2(lines.reduce((s, l) => s + l.total, 0));
  const tooMuch = kind === 'nc' && total - remaining > 0.009;
  const go = async () => {
    setBusy(true);
    const n = await run(() => noteFor(doc, kind, lines));
    setBusy(false);
    if (n) onDone(n);
  };
  return (
    <Modal open title={kind === 'nc' ? 'Nota de crédito' : 'Nota de débito'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" disabled={busy || !total || tooMuch} onClick={() => void go()}>{busy ? 'Emitiendo…' : `Emitir por ${fmtMoney(total)}`}</button></>}>
      {kind === 'nc' ? (<>
        <p className="small muted" style={{ marginTop: 0 }}>Anula total o parcialmente la factura (queda de {fmtMoney(remaining)}). Elegí qué se devuelve:</p>
        <ul className="salon-lines">
          {doc.lines.map((l, i) => (
            <li key={i} className="salon-line">
              <NumberInput aria-label={`Cantidad de ${l.name}`} value={qty[i]} min={0} onChange={(v) => setQty((q) => q.map((x, j) => (j === i ? Math.min(l.qty, Math.max(0, v ?? 0)) : x)))} style={{ width: 70 }} />
              <span className="grow salon-line-text"><span className="salon-line-name">{l.name}</span><span className="small muted">de {l.qty} × {fmtMoney(l.unitPrice)}</span></span>
            </li>
          ))}
        </ul>
        {tooMuch && <p className="small" style={{ color: 'var(--crit)' }}>Supera lo que queda de la factura.</p>}
      </>) : (
        <div className="form-grid cols-2">
          <Field label="Concepto"><Input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej.: diferencia de precio" /></Field>
          <Field label="Importe (IVA incluido)"><NumberInput value={amount} onChange={setAmount} min={0} /></Field>
        </div>
      )}
    </Modal>
  );
}

// ───────────── registro de ARCA ─────────────

function LogList({ entries }: { entries: FiscalLogEntry[] }) {
  return (
    <ul className="list fiscal-log-list">
      {entries.map((e) => (
        <li key={e.id} className="list-item" style={{ display: 'block' }}>
          <details>
            <summary><span className="num">{fmtDateTime(e.at)}</span> · <b>{e.op}</b> · {e.result ?? ''}{e.ms !== undefined ? ` · ${e.ms} ms` : ''}{e.error ? ` · ${e.error}` : ''}</summary>
            {e.request && <><p className="small muted">Pedido</p><pre className="fiscal-pre">{e.request}</pre></>}
            {e.response && <><p className="small muted">Respuesta</p><pre className="fiscal-pre">{e.response}</pre></>}
          </details>
        </li>
      ))}
    </ul>
  );
}

function ArcaLog() {
  const entries = (useLiveQuery(() => db.fiscalLog.orderBy('at').reverse().limit(200).toArray(), []) ?? EMPTY) as FiscalLogEntry[];
  if (!entries.length) return <div className="card"><EmptyState icon={<FileText size={40} />} title="Sin registros">Cada pedido a ARCA (con su respuesta) queda anotado acá, sin el token ni la firma.</EmptyState></div>;
  return <section className="card" aria-label="Registro de ARCA"><LogList entries={entries} /></section>;
}

// ───────────────────────── Libro IVA ventas ─────────────────────────

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** Libro IVA ventas del mes (para el contador): resumen por tipo de comprobante y Excel. */
function IvaBookTab({ docs, test }: { docs: FiscalDoc[]; test: boolean }) {
  const { run, notify } = useFeedback();
  const settings = useSettings();
  const [month, setMonth] = useState(thisMonth);
  const [withTest, setWithTest] = useState(test);
  const book = useMemo(() => ivaBook(docs, month, withTest), [docs, month, withTest]);
  const download = () => void run(async () => {
    const [{ toXlsx }, { downloadBlob }] = await Promise.all([import('../exports/writers'), import('../exports/download')]);
    const f = fiscalOf(settings);
    const blob = await toXlsx(`Libro IVA ventas ${month}${f.razonSocial ? ` · ${f.razonSocial}` : ''}${f.cuit ? ` · CUIT ${f.cuit}` : ''}`, [
      { title: 'Libro IVA ventas', columns: book.columns, rows: book.rows },
      { title: 'Resumen', columns: ['Comprobante', 'Cantidad', 'Desde', 'Hasta', 'Neto', 'IVA', 'Total'], rows: book.byType.map((t) => [t.name, t.count, t.first ?? '', t.last ?? '', t.neto, t.iva, t.total]) },
      { title: 'Por alícuota', columns: ['Alícuota', 'Neto gravado', 'IVA'], rows: [...book.totals.byRate].map(([r, v]) => [`${String(r).replace('.', ',')}%`, v.base, v.iva]) },
    ]);
    downloadBlob(blob, `libro-iva-ventas_${month}.xlsx`);
    notify('Libro IVA ventas descargado');
  });
  return (<>
    <div className="sales-period">
      <Field label="Mes"><Input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
      <button type="button" className="btn btn-sm" onClick={() => setMonth(thisMonth())}>Este mes</button>
      <button type="button" className="btn btn-sm" onClick={() => setMonth(lastMonth())}>Mes anterior</button>
      <button type="button" className="btn btn-primary" onClick={download} disabled={!book.count}><FileSpreadsheet size={18} aria-hidden /> Descargar Excel</button>
    </div>
    {test && <label className="check small"><input type="checkbox" checked={withTest} onChange={(e) => setWithTest(e.target.checked)} /> Incluir comprobantes de prueba (homologación)</label>}
    <div className="salon-stats" aria-label="Totales del libro">
      <div className="salon-stat"><span className="num">{fmtMoney(book.totals.total)}</span><span>total facturado</span></div>
      <div className="salon-stat"><span className="num">{fmtMoney(book.totals.neto)}</span><span>neto gravado</span></div>
      <div className="salon-stat"><span className="num">{fmtMoney(book.totals.iva)}</span><span>IVA débito fiscal</span></div>
      <div className="salon-stat"><span className="num">{book.count}</span><span>comprobantes</span></div>
    </div>
    {book.count === 0 ? (
      <div className="card"><EmptyState icon={<Receipt size={40} />} title="Sin comprobantes autorizados en este mes">El libro toma las facturas y notas autorizadas por ARCA, según la fecha del comprobante.</EmptyState></div>
    ) : (
      <section className="card" aria-labelledby="iva-resumen">
        <div className="card-head"><h2 id="iva-resumen">Resumen por comprobante</h2><span className="small muted">notas de crédito en negativo</span></div>
        <div className="table-wrap">
          <table className="table sales-table">
            <thead><tr><th>Comprobante</th><th className="num">Cant.</th><th>Números</th><th className="num">Neto</th><th className="num">IVA</th><th className="num">Total</th></tr></thead>
            <tbody>
              {book.byType.map((t) => (
                <tr key={t.cbteTipo}><td>{t.name}</td><td className="num">{t.count}</td><td className="num small">{t.first} a {t.last}</td><td className="num">{fmtMoney(t.neto)}</td><td className="num">{fmtMoney(t.iva)}</td><td className="num">{fmtMoney(t.total)}</td></tr>
              ))}
              {[...book.totals.byRate].map(([r, v]) => (
                <tr key={r} className="muted"><td colSpan={3}>IVA {String(r).replace('.', ',')}%</td><td className="num">{fmtMoney(v.base)}</td><td className="num">{fmtMoney(v.iva)}</td><td /></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}
  </>);
}

import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowRightLeft, Ban, BellRing, Printer, Check, ChefHat, CircleDollarSign, Minus, Pencil, Plus, Receipt, Search, Send, Trash2, UtensilsCrossed, Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { db } from '../database/db';
import { EMPTY } from '../hooks/useData';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { sinceLabel, useNow } from '../hooks/useNow';
import { useToday, startOfDayIso } from '../hooks/useToday';
import type { DiningTable, FiscalDoc, IvaRate, MenuItem, TableTicket, TicketLine } from '../models';
import { CBTE_NAME, IVA_RATES, PAYMENT_LABEL, docNumber, fiscalOf } from '../services/fiscalService';
import {
  addLine, addNumberedTables, cancelTicket, openTicket, isOpen, markDelivered, moveTicket, requestBill, retireTable, saveMenuItem, saveTable, sendToKitchen, updateLine, voidLine,
} from '../services/salonService';
import { useFeedback } from '../store/feedback';
import { Badge, EmptyState, Field, Input, NumberInput, PageHeader, Segmented, Select } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { CloudRulesNote } from '../components/salon/CloudRulesNote';
import { ChargeModal } from '../components/salon/ChargeModal';
import { comandaHtml, precuentaHtml, printHtml } from '../services/printService';
import { useSettings } from '../store/settings';
import { fmtMoney, fmtTime, matches } from '../utils/format';

type Tab = 'mesas' | 'carta' | 'hoy';

const useTables = () => (useLiveQuery(() => db.diningTables.orderBy('order').filter((t) => t.active).toArray(), []) ?? EMPTY) as DiningTable[];
const useMenu = () => (useLiveQuery(() => db.menuItems.orderBy('name').toArray(), []) ?? EMPTY) as MenuItem[];
const useOpenTickets = () => (useLiveQuery(() => db.tickets.where('status').anyOf('abierta', 'cuenta').toArray(), []) ?? EMPTY) as TableTicket[];

/**
 * Salón (tipo Fudo): plano de mesas, pedidos con comanda a cocina y cierre de mesa.
 * El cobro y la factura siguen en Maxirest: los pedidos cerrados quedan listos para pasarle.
 */
export function SalonPage() {
  const [tab, setTab] = useState<Tab>('mesas');
  const tables = useTables();
  const open = useOpenTickets();
  const openTotal = open.reduce((s, t) => s + t.total, 0);
  const busy = new Set(open.map((t) => t.tableId)).size;

  return (
    <div className="salon">
      <PageHeader
        title="Salón"
        subtitle={tables.length ? `${busy} de ${tables.length} mesas ocupadas${openTotal ? ` · ${fmtMoney(openTotal)} abierto` : ''}` : 'Mesas, pedidos y comandas a cocina.'}
        actions={<Segmented<Tab> label="Sección del salón" value={tab} onChange={setTab} options={[{ value: 'mesas', label: 'Mesas' }, { value: 'carta', label: 'Carta' }, { value: 'hoy', label: 'Hoy' }]} />}
      />
      <CloudRulesNote />
      {tab === 'mesas' && <TablesBoard tables={tables} open={open} onGoMenu={() => setTab('carta')} />}
      {tab === 'carta' && <MenuTab />}
      {tab === 'hoy' && <TodayTab />}
    </div>
  );
}

// ───────────────────────── Plano de mesas ─────────────────────────

function TablesBoard({ tables, open, onGoMenu }: { tables: DiningTable[]; open: TableTicket[]; onGoMenu: () => void }) {
  const { run } = useFeedback();
  const now = useNow();
  const menu = useMenu();
  const [zone, setZone] = useState('');
  const [sheet, setSheet] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [charging, setCharging] = useState<TableTicket | null>(null);
  const zones = useMemo(() => [...new Set(tables.map((t) => t.zone))], [tables]);
  const byTable = useMemo(() => new Map(open.map((t) => [t.tableId, t])), [open]);
  const shown = zone && zones.includes(zone) ? tables.filter((t) => t.zone === zone) : tables;
  const ready = open.filter((t) => t.lines.some((l) => l.status === 'listo' && l.qty > 0));

  if (!tables.length) return <FirstTables />;

  const tap = async (t: DiningTable) => {
    const current = byTable.get(t.id);
    if (current) return setSheet(current.id);
    const ticket = await run(() => openTicket(t.id));
    if (ticket) setSheet(ticket.id);
  };

  return (
    <>
      {menu.filter((m) => m.active).length === 0 && (
        <div className="alert alert-info" role="note">
          <UtensilsCrossed size={18} aria-hidden />
          <span>Para tomar pedidos primero cargá la carta. <button type="button" className="link-btn" onClick={onGoMenu}>Ir a la carta</button></span>
        </div>
      )}
      {ready.length > 0 && (
        <div className="salon-ready" role="status">
          <BellRing size={18} aria-hidden />
          <span>Para llevar: {ready.map((t) => `mesa ${t.tableName}`).join(', ')}</span>
        </div>
      )}
      <div className="salon-bar">
        {zones.length > 1 ? (
          <div className="group-chips" role="group" aria-label="Sector">
            <button type="button" className="group-chip" aria-pressed={!zone} onClick={() => setZone('')}>Todas</button>
            {zones.map((z) => <button key={z} type="button" className="group-chip" aria-pressed={zone === z} onClick={() => setZone(z)}>{z}</button>)}
          </div>
        ) : <span />}
        <button type="button" className="btn btn-sm" onClick={() => setManage(true)}><Pencil size={16} aria-hidden /> Mesas</button>
      </div>

      <ul className="salon-floor" aria-label="Mesas">
        {shown.map((t) => {
          const k = byTable.get(t.id);
          const live = k?.lines.filter((l) => l.qty > 0) ?? [];
          const state = !k ? 'libre' : k.status === 'cuenta' ? 'cuenta' : live.some((l) => l.status === 'listo') ? 'listo' : 'ocupada';
          const pending = live.filter((l) => l.status === 'nuevo').length;
          return (
            <li key={t.id}>
              <button type="button" className={`salon-table is-${state}`} onClick={() => void tap(t)} aria-label={`Mesa ${t.name}: ${STATE_LABEL[state]}`}>
                <span className="salon-table-name">{t.name}</span>
                <span className="salon-table-state">{STATE_LABEL[state]}</span>
                {k ? (
                  <span className="salon-table-meta">
                    <span className="num">{fmtMoney(k.total)}</span>
                    <span>{sinceLabel(k.openedAt, now)}{pending ? ` · ${pending} sin mandar` : ''}</span>
                  </span>
                ) : (
                  <span className="salon-table-meta"><span>{t.seats ? `${t.seats} lugares` : 'Tocá para abrir'}</span></span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {sheet && <TicketSheet ticketId={sheet} onClose={() => setSheet(null)} onCharge={(t) => { setSheet(null); setCharging(t); }} tables={tables} busy={new Set(byTable.keys())} />}
      {charging && <ChargeModal ticket={charging} onClose={(closed) => { const t = charging; setCharging(null); if (!closed) setSheet(t.id); }} />}
      {manage && <TablesModal onClose={() => setManage(false)} tables={tables} busy={new Set(byTable.keys())} />}
    </>
  );
}

const STATE_LABEL = { libre: 'Libre', ocupada: 'Ocupada', listo: 'Listo para llevar', cuenta: 'Pidió la cuenta' } as const;

function FirstTables() {
  const { run } = useFeedback();
  const [to, setTo] = useState<number | undefined>(12);
  const [zone, setZone] = useState('Salón');
  return (
    <div className="card">
      <EmptyState icon={<UtensilsCrossed size={40} />} title="Armá el salón">
        Creá las mesas numeradas de una vez. Después podés cambiarles el nombre, el sector o sumar más.
      </EmptyState>
      <form className="salon-first" onSubmit={(e) => { e.preventDefault(); void run(() => addNumberedTables(1, to ?? 0, zone), 'Mesas creadas'); }}>
        <Field label="Cantidad de mesas"><NumberInput value={to} onChange={setTo} min={1} /></Field>
        <Field label="Sector"><Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Salón, Terraza…" /></Field>
        <button type="submit" className="btn btn-primary"><Plus size={18} aria-hidden /> Crear mesas</button>
      </form>
    </div>
  );
}

function TablesModal({ onClose, tables, busy }: { onClose: () => void; tables: DiningTable[]; busy: Set<string> }) {
  const { run, confirm } = useFeedback();
  const zones = [...new Set(tables.map((t) => t.zone))];
  const [edit, setEdit] = useState<{ id?: string; name: string; zone: string; seats?: number } | null>(null);
  const [from, setFrom] = useState<number | undefined>(tables.length + 1);
  const [to, setTo] = useState<number | undefined>(tables.length + 4);
  const [zone, setZone] = useState(zones[0] ?? 'Salón');

  return (
    <Modal open title="Mesas" onClose={onClose} wide>
      <datalist id="salon-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
      {edit ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await saveTable(edit); setEdit(null); }, edit.id ? 'Mesa guardada' : 'Mesa agregada'); }}>
          <div className="form-grid cols-3">
            <Field label="Nombre o número"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-autofocus /></Field>
            <Field label="Sector"><Input list="salon-zones" value={edit.zone} onChange={(e) => setEdit({ ...edit, zone: e.target.value })} /></Field>
            <Field label="Lugares (opcional)"><NumberInput value={edit.seats} onChange={(v) => setEdit({ ...edit, seats: v })} min={1} /></Field>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary">Guardar</button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>Volver</button>
          </div>
        </form>
      ) : (<>
        <ul className="list salon-table-list">
          {tables.map((t) => (
            <li key={t.id} className="list-item">
              <div className="grow">
                <div className="list-title">Mesa {t.name}</div>
                <div className="list-sub">{t.zone}{t.seats ? ` · ${t.seats} lugares` : ''}{busy.has(t.id) ? ' · ocupada' : ''}</div>
              </div>
              <button type="button" className="btn btn-ghost icon-btn" aria-label={`Editar mesa ${t.name}`} onClick={() => setEdit({ id: t.id, name: t.name, zone: t.zone, seats: t.seats })}><Pencil size={18} /></button>
              <button type="button" className="btn btn-ghost icon-btn" aria-label={`Dar de baja la mesa ${t.name}`} disabled={busy.has(t.id)}
                onClick={async () => { if (await confirm({ title: `¿Dar de baja la mesa ${t.name}?`, message: 'Deja de aparecer en el salón. Los pedidos viejos quedan en el historial.', confirmLabel: 'Dar de baja', danger: true })) void run(() => retireTable(t.id), 'Mesa dada de baja'); }}><Trash2 size={18} /></button>
            </li>
          ))}
        </ul>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => setEdit({ name: '', zone: zones[0] ?? 'Salón' })}><Plus size={16} aria-hidden /> Una mesa</button>
        </div>
        <h3 className="salon-sub">Agregar varias numeradas</h3>
        <form className="salon-first" onSubmit={(e) => { e.preventDefault(); void run(async () => { const n = await addNumberedTables(from ?? 0, to ?? 0, zone); return n; }, 'Mesas agregadas'); }}>
          <Field label="Desde"><NumberInput value={from} onChange={setFrom} min={1} /></Field>
          <Field label="Hasta"><NumberInput value={to} onChange={setTo} min={1} /></Field>
          <Field label="Sector"><Input list="salon-zones" value={zone} onChange={(e) => setZone(e.target.value)} /></Field>
          <button type="submit" className="btn">Agregar</button>
        </form>
      </>)}
    </Modal>
  );
}

// ───────────────────────── Pedido de una mesa ─────────────────────────

const LINE_LABEL: Record<TicketLine['status'], string> = { nuevo: 'Sin mandar', cocina: 'En cocina', listo: 'Listo para llevar', entregado: 'En la mesa' };
const LINE_ORDER: TicketLine['status'][] = ['nuevo', 'listo', 'cocina', 'entregado'];

function TicketSheet({ ticketId, onClose, onCharge, tables, busy }: { ticketId: string; onClose: () => void; onCharge: (t: TableTicket) => void; tables: DiningTable[]; busy: Set<string> }) {
  const settings = useSettings();
  const { run, confirm, notify } = useFeedback();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const now = useNow();
  const ticket = useLiveQuery(() => db.tickets.get(ticketId), [ticketId]);
  const [view, setView] = useState<'carta' | 'pedido'>('carta');
  const [moving, setMoving] = useState(false);
  const [note, setNote] = useState<TicketLine | null>(null);

  if (ticket === undefined) return null;
  if (!ticket || !isOpen(ticket)) {
    return (
      <Modal open title="Pedido" onClose={onClose}>
        <p>{ticket?.status === 'cerrada' ? 'La mesa ya se cerró.' : 'El pedido ya no está abierto.'}</p>
      </Modal>
    );
  }
  const lines = ticket.lines;
  const unsent = lines.filter((l) => l.status === 'nuevo');
  const ready = lines.filter((l) => l.status === 'listo' && l.qty > 0);
  const send = () => void run(async () => {
    const { sent } = await sendToKitchen(ticket.id);
    notify(sent ? `Comanda mandada (${sent} ${sent === 1 ? 'plato' : 'platos'})` : 'No había nada para mandar');
  });
  const close = async () => {
    if (unsent.length) return notify('Hay platos sin mandar: mandalos a cocina o sacalos antes de cobrar.', { tone: 'error' });
    if (!lines.some((l) => l.qty > 0)) return notify('El pedido está vacío: si no se pidió nada, anulalo.', { tone: 'error' });
    onCharge(ticket);
  };
  const printPre = () => void run(() => printHtml(precuentaHtml(ticket, settings.businessName)));
  const kitchenLines = lines.filter((l) => l.status === 'cocina');
  const printComanda = () => void run(() => printHtml(comandaHtml(ticket, kitchenLines.length ? kitchenLines : lines.filter((l) => l.kitchen && l.status !== 'nuevo'))));
  const cancel = async () => {
    if (await confirm({ title: `¿Anular el pedido de la mesa ${ticket.tableName}?`, message: 'Se libera la mesa y el pedido queda como anulado (no pasa a Maxirest).', confirmLabel: 'Anular pedido', danger: true }))
      if (await run(() => cancelTicket(ticket.id), 'Pedido anulado')) onClose();
  };

  const order = (
    <section className="salon-order" aria-label="Pedido">
      {lines.length === 0 ? (
        <p className="muted salon-order-empty">Todavía no se pidió nada. Tocá los platos de la carta para sumarlos.</p>
      ) : LINE_ORDER.map((st) => {
        const group = lines.filter((l) => l.status === st);
        if (!group.length) return null;
        return (
          <div key={st} className={`salon-group is-${st}`}>
            <div className="salon-group-head">
              <h3>{LINE_LABEL[st]}</h3>
              {st === 'listo' && <button type="button" className="btn btn-sm" onClick={() => void run(() => markDelivered(ticket.id), 'Llevado a la mesa')}><Check size={16} aria-hidden /> Todo llevado</button>}
            </div>
            <ul className="salon-lines">
              {group.map((l) => (
                <li key={l.id} className={`salon-line${l.qty === 0 ? ' is-void' : ''}`}>
                  {st === 'nuevo' ? (
                    <span className="salon-qty" role="group" aria-label={`Cantidad de ${l.name}`}>
                      <button type="button" className="btn btn-ghost icon-btn" aria-label={`Uno menos de ${l.name}`} onClick={() => void run(() => updateLine(ticket.id, l.id, { qty: l.qty - 1 }))}><Minus size={16} /></button>
                      <b className="num">{l.qty}</b>
                      <button type="button" className="btn btn-ghost icon-btn" aria-label={`Uno más de ${l.name}`} onClick={() => void run(() => updateLine(ticket.id, l.id, { qty: l.qty + 1 }))}><Plus size={16} /></button>
                    </span>
                  ) : <b className="salon-qty-fixed num">{l.qty === 0 ? '—' : `${l.qty}×`}</b>}
                  <span className="grow salon-line-text">
                    <span className="salon-line-name">{l.name}{l.qty === 0 && <span className="small"> · anulado</span>}</span>
                    {l.notes && <span className="salon-line-note">{l.notes}</span>}
                    {st === 'cocina' && l.sentAt && <span className="small muted">hace {sinceLabel(l.sentAt, now)}</span>}
                  </span>
                  <span className="num salon-line-price">{l.qty ? fmtMoney(l.price * l.qty) : ''}</span>
                  {st === 'nuevo' && <button type="button" className="btn btn-ghost icon-btn" aria-label={`Nota para ${l.name}`} onClick={() => setNote(l)}><Pencil size={16} /></button>}
                  {st === 'listo' && <button type="button" className="btn btn-ghost icon-btn" aria-label={`Llevado: ${l.name}`} onClick={() => void run(() => markDelivered(ticket.id, l.id))}><Check size={18} /></button>}
                  {st !== 'nuevo' && l.qty > 0 && <button type="button" className="btn btn-ghost icon-btn" aria-label={`Anular ${l.name}`}
                    onClick={async () => { if (await confirm({ title: `¿Anular ${l.name}?`, message: 'Cocina lo ve tachado y no se cobra.', confirmLabel: 'Anular', danger: true })) void run(() => voidLine(ticket.id, l.id)); }}><Ban size={16} /></button>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );

  const footer = (
    <div className="salon-foot">
      <div className="salon-total"><span>Total</span><b className="num">{fmtMoney(ticket.total)}</b></div>
      <div className="salon-foot-actions">
        <button type="button" className="btn btn-primary" disabled={!unsent.length} onClick={send}><Send size={18} aria-hidden /> Mandar a cocina{unsent.length ? ` (${unsent.reduce((s, l) => s + l.qty, 0)})` : ''}</button>
        {ticket.status === 'abierta'
          ? <button type="button" className="btn" disabled={!lines.some((l) => l.qty > 0)} onClick={() => void run(() => requestBill(ticket.id), 'Cuenta pedida')}><Receipt size={18} aria-hidden /> Pidió la cuenta</button>
          : <button type="button" className="btn" onClick={() => void close()}><CircleDollarSign size={18} aria-hidden /> Cobrar y cerrar</button>}
      </div>
    </div>
  );

  return (
    <Modal open wide title={`Mesa ${ticket.tableName}`} onClose={onClose} footer={footer}>
      <div className="salon-sheet-meta">
        <span>Pedido #{ticket.number} · abierta {fmtTime(ticket.openedAt)} ({sinceLabel(ticket.openedAt, now)}){ticket.openedBy ? ` · ${ticket.openedBy.name}` : ''}</span>
        <GuestsInput ticket={ticket} />
      </div>
      {ready.length > 0 && <div className="salon-ready" role="status"><BellRing size={18} aria-hidden /> <span>Cocina tiene listo: {ready.map((l) => `${l.qty} ${l.name}`).join(', ')}</span></div>}
      {!desktop && (
        <Segmented<'carta' | 'pedido'> label="Ver" value={view} onChange={setView}
          options={[{ value: 'carta', label: 'Agregar' }, { value: 'pedido', label: `Pedido (${lines.filter((l) => l.qty > 0).reduce((s, l) => s + l.qty, 0)})` }]} />
      )}
      <div className="salon-sheet">
        {(desktop || view === 'carta') && <MenuPicker onPick={(m) => void run(() => addLine(ticket.id, m))} />}
        {(desktop || view === 'pedido') && order}
      </div>
      <div className="row wrap salon-sheet-more">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMoving(true)}><ArrowRightLeft size={16} aria-hidden /> Cambiar de mesa</button>
        {ticket.status === 'abierta' && lines.some((l) => l.qty > 0) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void close()}><CircleDollarSign size={16} aria-hidden /> Cobrar y cerrar</button>}
        {lines.some((l) => l.qty > 0) && <button type="button" className="btn btn-sm btn-ghost" onClick={printPre}><Printer size={16} aria-hidden /> Pre-cuenta</button>}
        {lines.some((l) => l.kitchen && l.status !== 'nuevo') && <button type="button" className="btn btn-sm btn-ghost" onClick={printComanda}><Printer size={16} aria-hidden /> Comanda</button>}
        <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => void cancel()}><Ban size={16} aria-hidden /> Anular pedido</button>
      </div>

      {moving && (
        <Modal open title="Cambiar de mesa" onClose={() => setMoving(false)}>
          <div className="salon-move">
            {tables.filter((t) => !busy.has(t.id)).map((t) => (
              <button key={t.id} type="button" className="btn" onClick={() => void run(async () => { await moveTicket(ticket.id, t.id); setMoving(false); }, `Pasado a la mesa ${t.name}`)}>Mesa {t.name}</button>
            ))}
            {tables.every((t) => busy.has(t.id)) && <p className="muted">No hay mesas libres.</p>}
          </div>
        </Modal>
      )}
      {note && <NoteModal line={note} onClose={() => setNote(null)} onSave={(v) => run(async () => { await updateLine(ticket.id, note.id, { notes: v }); setNote(null); })} />}
    </Modal>
  );
}

function GuestsInput({ ticket }: { ticket: TableTicket }) {
  const { run } = useFeedback();
  const set = (n: number) => run(() => db.tickets.update(ticket.id, { guests: n || undefined, updatedAt: new Date().toISOString() }));
  return (
    <span className="salon-guests" role="group" aria-label="Comensales">
      <Users size={16} aria-hidden />
      <button type="button" className="btn btn-ghost icon-btn" aria-label="Un comensal menos" disabled={!ticket.guests} onClick={() => void set((ticket.guests ?? 0) - 1)}><Minus size={14} /></button>
      <span className="num">{ticket.guests ?? 0}</span>
      <button type="button" className="btn btn-ghost icon-btn" aria-label="Un comensal más" onClick={() => void set((ticket.guests ?? 0) + 1)}><Plus size={14} /></button>
    </span>
  );
}

function NoteModal({ line, onClose, onSave }: { line: TicketLine; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(line.notes ?? '');
  const quick = ['Sin sal', 'Sin TACC', 'Bien cocido', 'Para compartir', 'Sin cebolla', 'Para llevar'];
  return (
    <Modal open title={`Nota: ${line.name}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => onSave(v)}>Guardar nota</button></>}>
      <Field label="Para la cocina"><Input value={v} onChange={(e) => setV(e.target.value)} placeholder="Ej.: sin sal, punto jugoso" data-autofocus /></Field>
      <div className="group-chips" style={{ marginTop: 10 }}>
        {quick.map((q) => <button key={q} type="button" className="group-chip" onClick={() => setV((p) => (p ? `${p}, ${q.toLowerCase()}` : q))}>{q}</button>)}
      </div>
    </Modal>
  );
}

function MenuPicker({ onPick }: { onPick: (m: MenuItem) => void }) {
  const menu = useMenu().filter((m) => m.active);
  const sections = useMemo(() => [...new Set(menu.map((m) => m.section))].sort((a, b) => a.localeCompare(b, 'es')), [menu]);
  const [sec, setSec] = useState('');
  const [q, setQ] = useState('');
  const list = q.trim() ? menu.filter((m) => matches(m.name, q)) : sec && sections.includes(sec) ? menu.filter((m) => m.section === sec) : menu;

  if (!menu.length) return <p className="muted">La carta está vacía. Cargala en la pestaña <b>Carta</b>.</p>;
  return (
    <section className="salon-picker" aria-label="Carta">
      <label className="production-search">
        <Search size={20} aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la carta" aria-label="Buscar en la carta" />
      </label>
      {!q.trim() && sections.length > 1 && (
        <div className="group-chips" role="group" aria-label="Sección de la carta">
          <button type="button" className="group-chip" aria-pressed={!sec} onClick={() => setSec('')}>Todo</button>
          {sections.map((s) => <button key={s} type="button" className="group-chip" aria-pressed={sec === s} onClick={() => setSec(s)}>{s}</button>)}
        </div>
      )}
      <div className="salon-items">
        {list.map((m) => (
          <button key={m.id} type="button" className="salon-item" onClick={() => onPick(m)} aria-label={`Agregar ${m.name}`}>
            <span className="salon-item-name">{m.name}</span>
            <span className="salon-item-price num">{fmtMoney(m.price)}</span>
            {m.kitchen && <ChefHat size={14} aria-label="Va a cocina" className="salon-item-k" />}
          </button>
        ))}
        {!list.length && <p className="muted">Nada con ese nombre.</p>}
      </div>
    </section>
  );
}

// ───────────────────────── Carta ─────────────────────────

type ItemDraft = { id?: string; name: string; section: string; price?: number; maxirestCode: string; kitchen: boolean; active: boolean; iva?: IvaRate };

function MenuTab() {
  const menu = useMenu();
  const [edit, setEdit] = useState<ItemDraft | null>(null);
  const [q, setQ] = useState('');
  const sections = useMemo(() => [...new Set(menu.map((m) => m.section))].sort((a, b) => a.localeCompare(b, 'es')), [menu]);
  const list = q.trim() ? menu.filter((m) => matches(m.name, q) || matches(m.section, q)) : menu;
  const noCode = menu.filter((m) => m.active && !m.maxirestCode).length;
  const blank = (): ItemDraft => ({ name: '', section: sections[0] ?? 'Desayunos', maxirestCode: '', kitchen: true, active: true });

  return (
    <>
      <div className="salon-bar">
        <label className="production-search salon-search">
          <Search size={20} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la carta" aria-label="Buscar en la carta" />
        </label>
        <button type="button" className="btn btn-primary" onClick={() => setEdit(blank())}><Plus size={18} aria-hidden /> Agregar a la carta</button>
      </div>
      {noCode > 0 && <p className="small muted">{noCode} {noCode === 1 ? 'plato no tiene' : 'platos no tienen'} código de Maxirest: cuando esté la API hace falta para pasarle los pedidos.</p>}

      {menu.length === 0 ? (
        <div className="card"><EmptyState icon={<UtensilsCrossed size={40} />} title="La carta está vacía" action={<button type="button" className="btn btn-primary" onClick={() => setEdit(blank())}><Plus size={18} aria-hidden /> Agregar el primero</button>}>
          Cargá lo que se vende en el salón: nombre, sección, precio y el código del artículo en Maxirest.
        </EmptyState></div>
      ) : (
        [...new Set(list.map((m) => m.section))].sort((a, b) => a.localeCompare(b, 'es')).map((s) => (
          <section key={s} className="card salon-menu-sec" aria-label={s}>
            <div className="card-head"><h2>{s}</h2><span className="small muted">{list.filter((m) => m.section === s).length}</span></div>
            <ul className="list">
              {list.filter((m) => m.section === s).map((m) => (
                <li key={m.id} className={`list-item${m.active ? '' : ' is-off'}`}>
                  <div className="grow">
                    <div className="list-title truncate">{m.name}</div>
                    <div className="list-sub">{m.kitchen ? 'Va a cocina' : 'Sale directo'}{m.maxirestCode ? ` · Maxirest ${m.maxirestCode}` : ' · sin código Maxirest'}{m.active ? '' : ' · pausado'}</div>
                  </div>
                  <b className="num">{fmtMoney(m.price)}</b>
                  <button type="button" className="btn btn-ghost icon-btn" aria-label={`Editar ${m.name}`}
                    onClick={() => setEdit({ id: m.id, name: m.name, section: m.section, price: m.price, maxirestCode: m.maxirestCode ?? '', kitchen: m.kitchen, active: m.active, iva: m.iva })}><Pencil size={18} /></button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {edit && <MenuItemModal draft={edit} sections={sections} onClose={() => setEdit(null)} />}
    </>
  );
}

function MenuItemModal({ draft, sections, onClose }: { draft: ItemDraft; sections: string[]; onClose: () => void }) {
  const { run } = useFeedback();
  const fiscal = fiscalOf(useSettings());
  const [d, setD] = useState(draft);
  const save = (again: boolean) => void run(async () => {
    await saveMenuItem({ ...d, price: d.price ?? NaN });
    if (again) setD({ ...d, id: undefined, name: '', price: undefined, maxirestCode: '' });
    else onClose();
  }, d.id ? 'Guardado en la carta' : 'Agregado a la carta');
  return (
    <Modal open title={d.id ? 'Editar de la carta' : 'Agregar a la carta'} onClose={onClose}
      footer={<>
        {!d.id && <button type="button" className="btn" onClick={() => save(true)}>Guardar y otro</button>}
        <button type="button" className="btn btn-primary" onClick={() => save(false)}>Guardar</button>
      </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <datalist id="salon-sections">{[...new Set([...sections, 'Desayunos', 'Panadería', 'Cafetería', 'Bebidas', 'Principales', 'Postres'])].map((s) => <option key={s} value={s} />)}</datalist>
        <Field label="Nombre"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Ej.: Desayuno americano" data-autofocus /></Field>
        <div className="form-grid cols-3">
          <Field label="Sección"><Input list="salon-sections" value={d.section} onChange={(e) => setD({ ...d, section: e.target.value })} /></Field>
          <Field label="Precio"><NumberInput value={d.price} onChange={(v) => setD({ ...d, price: v })} min={0} placeholder="0" /></Field>
          <Field label="Código en Maxirest" hint="El número del artículo en Maxirest, para pasarle el pedido."><Input value={d.maxirestCode} onChange={(e) => setD({ ...d, maxirestCode: e.target.value })} inputMode="numeric" /></Field>
          {fiscal.enabled && fiscal.condicionIva === 'RI' && (
            <Field label="IVA incluido en el precio">
              <Select value={d.iva ?? ''} onChange={(e) => setD({ ...d, iva: e.target.value === '' ? undefined : (Number(e.target.value) as IvaRate) })}>
                <option value="">El de la configuración ({String(fiscal.ivaDefault).replace('.', ',')}%)</option>
                {IVA_RATES.map((r) => <option key={r} value={r}>{String(r).replace('.', ',')}%</option>)}
              </Select>
            </Field>
          )}
        </div>
        <label className="check"><input type="checkbox" checked={d.kitchen} onChange={(e) => setD({ ...d, kitchen: e.target.checked })} /> Va a la pantalla de cocina</label>
        {d.id && <label className="check"><input type="checkbox" checked={!d.active} onChange={(e) => setD({ ...d, active: !e.target.checked })} /> Pausado (no se puede pedir)</label>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ───────────────────────── Hoy ─────────────────────────

const MAXIREST_LABEL = { pendiente: 'Esperando Maxirest', enviado: 'Pasado a Maxirest', error: 'Error con Maxirest' } as const;
const MAXIREST_TONE = { pendiente: 'warn', enviado: 'ok', error: 'danger' } as const;

function TodayTab() {
  const today = useToday();
  const since = startOfDayIso(today);
  const tickets = (useLiveQuery(() => db.tickets.where('openedAt').aboveOrEqual(since).reverse().sortBy('openedAt'), [since]) ?? EMPTY) as TableTicket[];
  const [detail, setDetail] = useState<TableTicket | null>(null);
  const closed = tickets.filter((t) => t.status === 'cerrada');
  const sold = closed.reduce((s, t) => s + t.total, 0);
  const guests = closed.reduce((s, t) => s + (t.guests ?? 0), 0);
  const waiting = closed.filter((t) => t.maxirest?.status !== 'enviado').length;
  const top = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of closed) for (const l of t.lines) if (l.qty > 0) m.set(l.name, (m.get(l.name) ?? 0) + l.qty);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [closed]);

  const fiscal = (useLiveQuery(() => db.fiscalDocs.where('ticketId').anyOf(tickets.map((t) => t.id)).toArray(), [tickets]) ?? EMPTY) as FiscalDoc[];
  const docOf = new Map(fiscal.map((d) => [d.id, d]));
  const byMethod = new Map<string, number>();
  for (const t of closed) for (const p of t.payments ?? []) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);

  return (
    <>
      <div className="salon-stats">
        <div className="salon-stat"><span className="num">{fmtMoney(sold)}</span><span>vendido en mesas</span></div>
        <div className="salon-stat"><span className="num">{closed.length}</span><span>{closed.length === 1 ? 'mesa cerrada' : 'mesas cerradas'}</span></div>
        <div className="salon-stat"><span className="num">{closed.length ? fmtMoney(sold / closed.length) : '—'}</span><span>promedio por mesa</span></div>
        <div className="salon-stat"><span className="num">{guests || '—'}</span><span>comensales</span></div>
      </div>
      {byMethod.size > 0 && (
        <p className="small salon-caja"><b>Caja:</b> {[...byMethod.entries()].map(([m, v]) => `${PAYMENT_LABEL[m as keyof typeof PAYMENT_LABEL]} ${fmtMoney(v)}`).join(' · ')}</p>
      )}
      {waiting > 0 && <p className="small muted">{waiting} {waiting === 1 ? 'pedido espera' : 'pedidos esperan'} para pasar a Maxirest: se mandan cuando esté habilitada la API. Mientras tanto, se cobran en Maxirest como siempre.</p>}

      {tickets.length === 0 ? (
        <div className="card"><EmptyState icon={<Receipt size={40} />} title="Todavía no hubo mesas hoy">Cuando se abra la primera mesa aparece acá.</EmptyState></div>
      ) : (
        <div className="salon-today">
          <section className="card" aria-labelledby="salon-today-list">
            <div className="card-head"><h2 id="salon-today-list">Pedidos de hoy</h2></div>
            <ul className="list">
              {tickets.map((t) => (
                <li key={t.id} className="list-item">
                  <button type="button" className="list-btn grow" onClick={() => setDetail(t)}>
                    <span className="list-title">Mesa {t.tableName} · #{t.number}</span>
                    <span className="list-sub">{fmtTime(t.openedAt)}{t.closedAt ? `–${fmtTime(t.closedAt)}` : ''}{t.openedBy ? ` · ${t.openedBy.name}` : ''} · {t.lines.filter((l) => l.qty > 0).reduce((s, l) => s + l.qty, 0)} ítems</span>
                  </button>
                  <span className="salon-today-right">
                    <b className="num">{fmtMoney(t.total)}</b>
                    {t.status === 'cerrada' && t.fiscalDocId && docOf.get(t.fiscalDocId) ? <FiscalBadge d={docOf.get(t.fiscalDocId)!} />
                      : t.status === 'cerrada' && t.fiscalPending ? <Badge tone="warn">Sin facturar</Badge>
                      : t.status === 'cerrada' && t.maxirest ? <Badge tone={MAXIREST_TONE[t.maxirest.status]}>{MAXIREST_LABEL[t.maxirest.status]}</Badge>
                      : <Badge tone={t.status === 'anulada' ? '' : 'info'}>{t.status === 'anulada' ? 'Anulado' : 'Abierta'}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {top.length > 0 && (
            <section className="card" aria-labelledby="salon-top">
              <div className="card-head"><h2 id="salon-top">Lo más pedido</h2></div>
              <ol className="salon-top">{top.map(([n, q]) => <li key={n}><span className="grow">{n}</span><b className="num">{q}</b></li>)}</ol>
            </section>
          )}
        </div>
      )}
      {detail && <TicketDetail ticket={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function FiscalBadge({ d }: { d: FiscalDoc }) {
  if (d.status === 'autorizada') return <Badge tone="ok">{CBTE_NAME[d.cbteTipo]} {docNumber(d)}</Badge>;
  return <Badge tone={d.status === 'rechazada' || d.status === 'error' ? 'danger' : 'warn'}>{d.status === 'rechazada' ? 'Factura rechazada' : d.status === 'error' ? 'Factura con error' : 'Factura sin confirmar'}</Badge>;
}

function TicketDetail({ ticket, onClose }: { ticket: TableTicket; onClose: () => void }) {
  const menu = useMenu();
  const codes = new Map(menu.map((m) => [m.id, m.maxirestCode]));
  const lines = ticket.lines.filter((l) => l.qty > 0);
  const missing = lines.filter((l) => !codes.get(l.menuItemId));
  return (
    <Modal open title={`Mesa ${ticket.tableName} · #${ticket.number}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Abierta {fmtTime(ticket.openedAt)}{ticket.closedAt ? `, cerrada ${fmtTime(ticket.closedAt)}` : ''}{ticket.openedBy ? ` · ${ticket.openedBy.name}` : ''}{ticket.guests ? ` · ${ticket.guests} comensales` : ''}</p>
      <ul className="salon-lines">
        {ticket.lines.map((l) => (
          <li key={l.id} className={`salon-line${l.qty === 0 ? ' is-void' : ''}`}>
            <b className="salon-qty-fixed num">{l.qty ? `${l.qty}×` : '—'}</b>
            <span className="grow salon-line-text"><span className="salon-line-name">{l.name}{l.qty === 0 && <span className="small"> · anulado</span>}</span>{l.notes && <span className="salon-line-note">{l.notes}</span>}</span>
            <span className="small muted">{codes.get(l.menuItemId) ? `Maxirest ${codes.get(l.menuItemId)}` : ''}</span>
            <span className="num salon-line-price">{l.qty ? fmtMoney(l.qty * l.price) : ''}</span>
          </li>
        ))}
      </ul>
      <div className="salon-total"><span>Total</span><b className="num">{fmtMoney(ticket.total)}</b></div>
      {ticket.status === 'cerrada' && missing.length > 0 && <p className="small" style={{ color: 'var(--low)' }}>Sin código de Maxirest: {missing.map((l) => l.name).join(', ')}. Cargalo en la carta antes de que se pase.</p>}
      <p className="small muted">Para ver lo que cocina tiene pendiente, abrí <Link to="/cocina">Cocina</Link>.</p>
    </Modal>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowRightLeft, Ban, BellRing, Check, ChefHat, CircleDollarSign, Gift, Minus, Pencil, Percent, Plus, Printer, Receipt, Search, Send, Star, UserRound, Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { db } from '../../database/db';
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { sinceLabel, useNow } from '../../hooks/useNow';
import type { DiningTable, MenuExtra, MenuItem, TableTicket, TicketDiscount, TicketLine } from '../../models';
import { precuentaHtml, printComanda as printComandaFor, printHtml, ticketBusiness } from '../../services/printService';
import {
  addCustomLine, addLine, cancelTicket, channelOf, chargedAmount, discountAmount, isOpen, markDelivered, moveTicket, paidQty, remainingAmount, requestBill, sendToKitchen,
  setComp, setDiscount, ticketLabel, updateCustomer, updateLine, voidLine,
} from '../../services/salonService';
import { useFeedback } from '../../store/feedback';
import { useSettings } from '../../store/settings';
import { fmtMoney, fmtTime, matches } from '../../utils/format';
import { Field, Input, NumberInput, Segmented } from '../ui';
import { Modal } from '../ui/Modal';
import { useMenu, useTopItems } from './hooks';

const LINE_LABEL: Record<TicketLine['status'], string> = { nuevo: 'Sin mandar', cocina: 'En cocina', listo: 'Listo para llevar', entregado: 'Entregado' };
const LINE_ORDER: TicketLine['status'][] = ['nuevo', 'listo', 'cocina', 'entregado'];

/** El pedido abierto (mesa, mostrador, para llevar o delivery): carta, comanda, descuentos y cobro. */
export function TicketSheet({ ticketId, onClose, onCharge, tables, busy }: { ticketId: string; onClose: () => void; onCharge: (t: TableTicket) => void; tables: DiningTable[]; busy: Set<string> }) {
  const settings = useSettings();
  const { run, confirm, notify } = useFeedback();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const now = useNow();
  const ticket = useLiveQuery(() => db.tickets.get(ticketId), [ticketId]);
  const [view, setView] = useState<'carta' | 'pedido'>('carta');
  const [moving, setMoving] = useState(false);
  const [note, setNote] = useState<TicketLine | null>(null);
  const [extrasFor, setExtrasFor] = useState<MenuItem | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);

  if (ticket === undefined) return null;
  if (!ticket || !isOpen(ticket)) {
    return (
      <Modal open title="Pedido" onClose={onClose}>
        <p>{ticket?.status === 'cerrada' ? 'El pedido ya se cerró.' : 'El pedido ya no está abierto.'}</p>
      </Modal>
    );
  }
  const label = ticketLabel(ticket);
  const isTable = channelOf(ticket) === 'mesa';
  const lines = ticket.lines;
  const live = lines.filter((l) => l.qty > 0);
  const unsent = lines.filter((l) => l.status === 'nuevo');
  const ready = lines.filter((l) => l.status === 'listo' && l.qty > 0);
  const charged = chargedAmount(ticket);
  const remaining = remainingAmount(ticket);
  const discount = discountAmount(ticket.subtotal ?? ticket.total, ticket.discount);
  const pick = (m: MenuItem) => (m.extras?.length ? setExtrasFor(m) : void run(() => addLine(ticket.id, m)));
  const send = () => void run(async () => {
    const { sent } = await sendToKitchen(ticket.id);
    notify(sent ? `Comanda mandada (${sent} ${sent === 1 ? 'plato' : 'platos'})` : 'No había nada para mandar');
  });
  const charge = () => {
    if (unsent.length) return notify('Hay platos sin mandar: mandalos a cocina o sacalos antes de cobrar.', { tone: 'error' });
    if (!live.length) return notify('El pedido está vacío: si no se pidió nada, anulalo.', { tone: 'error' });
    onCharge(ticket);
  };
  const printPre = () => void run(() => printHtml(precuentaHtml(ticket, ticketBusiness(settings))));
  const kitchenLines = lines.filter((l) => l.status === 'cocina');
  const printComanda = () => void run(() => printComandaFor(ticket, kitchenLines.length ? kitchenLines : lines.filter((l) => l.kitchen && l.status !== 'nuevo')));
  const cancel = async () => {
    if (await confirm({ title: `¿Anular el pedido (${label})?`, message: isTable ? 'Se libera la mesa y el pedido queda como anulado.' : 'El pedido queda como anulado.', confirmLabel: 'Anular pedido', danger: true }))
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
              <h3>{st === 'entregado' && isTable ? 'En la mesa' : LINE_LABEL[st]}</h3>
              {st === 'listo' && <button type="button" className="btn btn-sm" onClick={() => void run(() => markDelivered(ticket.id), isTable ? 'Llevado a la mesa' : 'Entregado')}><Check size={16} aria-hidden /> Todo {isTable ? 'llevado' : 'entregado'}</button>}
            </div>
            <ul className="salon-lines">
              {group.map((l) => {
                const paid = paidQty(ticket, l.id);
                return (
                  <li key={l.id} className={`salon-line${l.qty === 0 ? ' is-void' : ''}${l.comp ? ' is-comp' : ''}`}>
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
                      {l.comp && <span className="small salon-comp">Cortesía · no se cobra</span>}
                      {paid > 0 && <span className="small muted">{paid >= l.qty ? 'Pagado' : `${paid} pagado${paid === 1 ? '' : 's'}`}</span>}
                      {st === 'cocina' && l.sentAt && <span className="small muted">hace {sinceLabel(l.sentAt, now)}</span>}
                    </span>
                    <span className={`num salon-line-price${l.comp ? ' is-struck' : ''}`}>{l.qty ? fmtMoney(l.price * l.qty) : ''}</span>
                    {st === 'nuevo' && <button type="button" className="btn btn-ghost icon-btn" aria-label={`Nota para ${l.name}`} onClick={() => setNote(l)}><Pencil size={16} /></button>}
                    {st === 'listo' && <button type="button" className="btn btn-ghost icon-btn" aria-label={`Entregado: ${l.name}`} onClick={() => void run(() => markDelivered(ticket.id, l.id))}><Check size={18} /></button>}
                    {l.qty > 0 && !paid && (
                      <button type="button" className={`btn btn-ghost icon-btn${l.comp ? ' is-on' : ''}`} aria-pressed={!!l.comp} aria-label={l.comp ? `Cobrar ${l.name}` : `Invitar ${l.name} (cortesía)`}
                        onClick={() => void run(() => setComp(ticket.id, l.id, !l.comp), l.comp ? 'Se vuelve a cobrar' : 'Cortesía: no se cobra')}><Gift size={16} /></button>
                    )}
                    {st !== 'nuevo' && l.qty > 0 && !paid && <button type="button" className="btn btn-ghost icon-btn" aria-label={`Anular ${l.name}`}
                      onClick={async () => { if (await confirm({ title: `¿Anular ${l.name}?`, message: 'Cocina lo ve tachado y no se cobra.', confirmLabel: 'Anular', danger: true })) void run(() => voidLine(ticket.id, l.id)); }}><Ban size={16} /></button>}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {(discount > 0 || charged > 0) && (
        <div className="salon-sums">
          <div className="row"><span className="grow">Subtotal</span><span className="num">{fmtMoney(ticket.subtotal ?? ticket.total)}</span></div>
          {discount > 0 && <div className="row"><span className="grow">Descuento{ticket.discount?.kind === 'pct' ? ` ${ticket.discount.value}%` : ''}{ticket.discount?.reason ? ` · ${ticket.discount.reason}` : ''}</span><span className="num">−{fmtMoney(discount)}</span></div>}
          {charged > 0 && <div className="row"><span className="grow">Ya cobrado ({ticket.charges!.length} {ticket.charges!.length === 1 ? 'parte' : 'partes'})</span><span className="num">−{fmtMoney(charged)}</span></div>}
        </div>
      )}
    </section>
  );

  const footer = (
    <div className="salon-foot">
      <div className="salon-total"><span>{charged > 0 ? 'Falta cobrar' : 'Total'}</span><b className="num">{fmtMoney(charged > 0 ? remaining : ticket.total)}</b></div>
      <div className="salon-foot-actions">
        <button type="button" className="btn btn-primary" disabled={!unsent.length} onClick={send}><Send size={18} aria-hidden /> Mandar a cocina{unsent.length ? ` (${unsent.reduce((s, l) => s + l.qty, 0)})` : ''}</button>
        {isTable && ticket.status === 'abierta' && !charged
          ? <button type="button" className="btn" disabled={!live.length} onClick={() => void run(() => requestBill(ticket.id), 'Cuenta pedida')}><Receipt size={18} aria-hidden /> Pidió la cuenta</button>
          : <button type="button" className="btn" disabled={!live.length} onClick={charge}><CircleDollarSign size={18} aria-hidden /> {charged > 0 ? 'Seguir cobrando' : 'Cobrar'}</button>}
      </div>
    </div>
  );

  return (
    <Modal open wide title={label} onClose={onClose} footer={footer}>
      <div className="salon-sheet-meta">
        <span>Pedido #{ticket.number} · {isTable ? 'abierta' : 'tomado'} {fmtTime(ticket.openedAt)} ({sinceLabel(ticket.openedAt, now)}){ticket.openedBy ? ` · ${ticket.openedBy.name}` : ''}</span>
        {isTable ? <GuestsInput ticket={ticket} /> : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCustomerOpen(true)}>
            <UserRound size={16} aria-hidden /> {ticket.customer?.name || ticket.customer?.phone || 'Datos del cliente'}
          </button>
        )}
      </div>
      {!isTable && ticket.customer?.address && <p className="small salon-address">Entregar en: <b>{ticket.customer.address}</b>{ticket.customer.phone ? ` · Tel. ${ticket.customer.phone}` : ''}</p>}
      {ready.length > 0 && <div className="salon-ready" role="status"><BellRing size={18} aria-hidden /> <span>Cocina tiene listo: {ready.map((l) => `${l.qty} ${l.name}`).join(', ')}</span></div>}
      {!desktop && (
        <Segmented<'carta' | 'pedido'> label="Ver" value={view} onChange={setView}
          options={[{ value: 'carta', label: 'Agregar' }, { value: 'pedido', label: `Pedido (${live.reduce((s, l) => s + l.qty, 0)})` }]} />
      )}
      <div className="salon-sheet">
        {(desktop || view === 'carta') && <MenuPicker onPick={pick} />}
        {(desktop || view === 'pedido') && order}
      </div>
      <div className="row wrap salon-sheet-more">
        {isTable && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMoving(true)}><ArrowRightLeft size={16} aria-hidden /> Cambiar de mesa</button>}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCustomOpen(true)}><Plus size={16} aria-hidden /> Ítem libre</button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={charged > 0} onClick={() => setDiscountOpen(true)}><Percent size={16} aria-hidden /> {ticket.discount ? 'Cambiar descuento' : 'Descuento'}</button>
        {isTable && ticket.status === 'abierta' && live.length > 0 && !charged && <button type="button" className="btn btn-sm btn-ghost" onClick={charge}><CircleDollarSign size={16} aria-hidden /> Cobrar</button>}
        {live.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={printPre}><Printer size={16} aria-hidden /> Pre-cuenta</button>}
        {lines.some((l) => l.kitchen && l.status !== 'nuevo') && <button type="button" className="btn btn-sm btn-ghost" onClick={printComanda}><Printer size={16} aria-hidden /> Comanda</button>}
        {!charged && <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => void cancel()}><Ban size={16} aria-hidden /> Anular pedido</button>}
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
      {extrasFor && <ExtrasModal item={extrasFor} onClose={() => setExtrasFor(null)} onAdd={(ex) => run(async () => { await addLine(ticket.id, extrasFor, 1, undefined, ex); setExtrasFor(null); })} />}
      {discountOpen && <DiscountModal current={ticket.discount} subtotal={ticket.subtotal ?? ticket.total} onClose={() => setDiscountOpen(false)}
        onSave={(d) => run(async () => { await setDiscount(ticket.id, d); setDiscountOpen(false); }, d ? 'Descuento aplicado' : 'Descuento quitado')} />}
      {customOpen && <CustomLineModal onClose={() => setCustomOpen(false)} onAdd={(n, p, k) => run(async () => { await addCustomLine(ticket.id, n, p, k); setCustomOpen(false); }, 'Agregado')} />}
      {customerOpen && <CustomerModal ticket={ticket} onClose={() => setCustomerOpen(false)} />}
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

/** Elegir adicionales al pedir un plato que los tiene. */
function ExtrasModal({ item, onClose, onAdd }: { item: MenuItem; onClose: () => void; onAdd: (extras: MenuExtra[]) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const chosen = (item.extras ?? []).filter((e) => sel.has(e.name));
  const price = item.price + chosen.reduce((s, e) => s + e.price, 0);
  const toggle = (n: string) => setSel((p) => { const x = new Set(p); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  return (
    <Modal open title={item.name} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => onAdd(chosen)}>Agregar · {fmtMoney(price)}</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>Adicionales (opcional):</p>
      <div className="salon-extras">
        {(item.extras ?? []).map((e) => (
          <label key={e.name} className={`salon-extra${sel.has(e.name) ? ' is-on' : ''}`}>
            <input type="checkbox" checked={sel.has(e.name)} onChange={() => toggle(e.name)} />
            <span className="grow">{e.name}</span>
            <span className="num">{e.price ? `+${fmtMoney(e.price)}` : 'sin cargo'}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function DiscountModal({ current, subtotal, onClose, onSave }: { current?: TicketDiscount; subtotal: number; onClose: () => void; onSave: (d: TicketDiscount | null) => void }) {
  const [kind, setKind] = useState<'pct' | 'monto'>(current?.kind ?? 'pct');
  const [value, setValue] = useState<number | undefined>(current?.value);
  const [reason, setReason] = useState(current?.reason ?? '');
  const amount = value ? discountAmount(subtotal, { kind, value }) : 0;
  return (
    <Modal open title="Descuento" onClose={onClose}
      footer={<>
        {current && <button type="button" className="btn btn-ghost danger-text" onClick={() => onSave(null)}>Quitar descuento</button>}
        <button type="button" className="btn btn-primary" disabled={!value} onClick={() => onSave({ kind, value: value ?? 0, reason })}>Aplicar {amount ? `−${fmtMoney(amount)}` : ''}</button>
      </>}>
      <div className="stack">
        <Segmented<'pct' | 'monto'> label="Tipo de descuento" value={kind} onChange={setKind} options={[{ value: 'pct', label: 'Porcentaje' }, { value: 'monto', label: 'Monto fijo' }]} />
        <div className="group-chips">
          {(kind === 'pct' ? [5, 10, 15, 20, 50] : []).map((p) => <button key={p} type="button" className="group-chip" aria-pressed={value === p} onClick={() => setValue(p)}>{p}%</button>)}
        </div>
        <Field label={kind === 'pct' ? 'Porcentaje' : 'Monto'}><NumberInput value={value} onChange={setValue} min={0} /></Field>
        <Field label="Motivo (opcional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cliente habitual, demora, cumpleaños…" /></Field>
        <p className="small muted" style={{ margin: 0 }}>Subtotal {fmtMoney(subtotal)} → total {fmtMoney(Math.max(0, subtotal - amount))}. En la factura aparece como bonificación.</p>
      </div>
    </Modal>
  );
}

function CustomLineModal({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, price: number, kitchen: boolean) => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | undefined>();
  const [kitchen, setKitchen] = useState(false);
  return (
    <Modal open title="Ítem libre" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" disabled={!name.trim() || price === undefined} onClick={() => onAdd(name, price ?? 0, kitchen)}>Agregar</button></>}>
      <div className="stack">
        <div className="group-chips">{['Envío', 'Cubierto', 'Varios'].map((n) => <button key={n} type="button" className="group-chip" aria-pressed={name === n} onClick={() => setName(n)}>{n}</button>)}</div>
        <div className="form-grid cols-2">
          <Field label="Qué es"><Input value={name} onChange={(e) => setName(e.target.value)} data-autofocus /></Field>
          <Field label="Precio"><NumberInput value={price} onChange={setPrice} min={0} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={kitchen} onChange={(e) => setKitchen(e.target.checked)} /> Va a la pantalla de cocina</label>
      </div>
    </Modal>
  );
}

function CustomerModal({ ticket, onClose }: { ticket: TableTicket; onClose: () => void }) {
  const { run } = useFeedback();
  const [c, setC] = useState({ name: ticket.customer?.name ?? '', phone: ticket.customer?.phone ?? '', address: ticket.customer?.address ?? '' });
  return (
    <Modal open title="Cliente" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void run(async () => { await updateCustomer(ticket.id, c); onClose(); }, 'Cliente guardado')}>Guardar</button></>}>
      <div className="form-grid cols-2">
        <Field label="Nombre"><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} data-autofocus /></Field>
        <Field label="Teléfono"><Input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} inputMode="tel" /></Field>
        {channelOf(ticket) === 'delivery' && <Field label="Dirección"><Input value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
}

const TOP = '\u0000top';

export function MenuPicker({ onPick }: { onPick: (m: MenuItem) => void }) {
  const menu = useMenu().filter((m) => m.active);
  const sections = useMemo(() => [...new Set(menu.map((m) => m.section))].sort((a, b) => a.localeCompare(b, 'es')), [menu]);
  const top = useTopItems();
  const topItems = useMemo(() => top.map((id) => menu.find((m) => m.id === id)).filter((m): m is MenuItem => !!m), [top, menu]);
  // "Más pedidos" arranca elegido cuando ya hay historial suficiente (es lo que más se toca).
  const hasTop = topItems.length >= 4 && menu.length > topItems.length;
  const [secState, setSec] = useState<string | null>(null);
  const sec = secState ?? (hasTop ? TOP : '');
  const [q, setQ] = useState('');
  const list = q.trim() ? menu.filter((m) => matches(m.name, q) || matches(m.section, q))
    : sec === TOP && hasTop ? topItems
      : sec && sections.includes(sec) ? menu.filter((m) => m.section === sec) : menu;

  if (!menu.length) return <p className="muted">La carta está vacía. Cargala en la pestaña <b>Carta</b>.</p>;
  return (
    <section className="salon-picker" aria-label="Carta">
      <label className="production-search">
        <Search size={20} aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la carta" aria-label="Buscar en la carta" />
      </label>
      {!q.trim() && (sections.length > 1 || hasTop) && (
        <div className="group-chips" role="group" aria-label="Sección de la carta">
          {hasTop && <button type="button" className="group-chip" aria-pressed={sec === TOP} onClick={() => setSec(TOP)}><Star size={14} aria-hidden /> Más pedidos</button>}
          <button type="button" className="group-chip" aria-pressed={!sec} onClick={() => setSec('')}>Todo</button>
          {sections.map((s) => <button key={s} type="button" className="group-chip" aria-pressed={sec === s} onClick={() => setSec(s)}>{s}</button>)}
        </div>
      )}
      <div className="salon-items">
        {list.map((m) => (
          <button key={m.id} type="button" className="salon-item" onClick={() => onPick(m)} aria-label={`Agregar ${m.name}`}>
            <span className="salon-item-name">{m.name}</span>
            <span className="salon-item-price num">{fmtMoney(m.price)}{m.extras?.length ? ' · con adicionales' : ''}</span>
            {m.kitchen && <ChefHat size={14} aria-label="Va a cocina" className="salon-item-k" />}
          </button>
        ))}
        {!list.length && <p className="muted">Nada con ese nombre.</p>}
      </div>
    </section>
  );
}

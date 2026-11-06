import { Bike, Plus, ShoppingBag, Store } from 'lucide-react';
import { useState } from 'react';
import { sinceLabel, useNow } from '../../hooks/useNow';
import type { TableTicket, TicketChannel } from '../../models';
import { CHANNEL_LABEL, channelOf, openCounterTicket, ticketLabel } from '../../services/salonService';
import { useFeedback } from '../../store/feedback';
import { fmtMoney } from '../../utils/format';
import { EmptyState, Field, Input, NumberInput, Segmented } from '../ui';
import { Modal } from '../ui/Modal';

type Counter = Exclude<TicketChannel, 'mesa'>;
const ICON = { mostrador: Store, llevar: ShoppingBag, delivery: Bike } as const;

function stage(t: TableTicket) {
  const live = t.lines.filter((l) => l.qty > 0);
  if (!live.length) return { label: 'Sin ítems', tone: '' };
  if (live.some((l) => l.status === 'nuevo')) return { label: 'Sin mandar', tone: 'warn' };
  if (live.some((l) => l.status === 'cocina')) return { label: 'En cocina', tone: 'info' };
  if (live.some((l) => l.status === 'listo')) return { label: channelOf(t) === 'delivery' ? 'Listo para salir' : 'Listo para entregar', tone: 'ok' };
  return { label: 'Para cobrar', tone: '' };
}

/** Mostrador, para llevar y delivery: pedidos sin mesa. */
export function CounterTab({ open, onOpen }: { open: TableTicket[]; onOpen: (id: string) => void }) {
  const now = useNow();
  const [creating, setCreating] = useState<Counter | null>(null);
  const [filter, setFilter] = useState<'todos' | Counter>('todos');
  const list = open.filter((t) => channelOf(t) !== 'mesa' && (filter === 'todos' || channelOf(t) === filter)).sort((a, b) => a.openedAt.localeCompare(b.openedAt));

  return (<>
    <div className="salon-new" role="group" aria-label="Nuevo pedido">
      {(['mostrador', 'llevar', 'delivery'] as Counter[]).map((c) => {
        const Icon = ICON[c];
        return <button key={c} type="button" className="salon-new-btn" onClick={() => setCreating(c)}><Icon size={22} aria-hidden /><span>Nuevo · {CHANNEL_LABEL[c]}</span></button>;
      })}
    </div>
    <Segmented<'todos' | Counter> label="Ver pedidos" value={filter} onChange={setFilter}
      options={[{ value: 'todos', label: 'Todos' }, { value: 'mostrador', label: 'Mostrador' }, { value: 'llevar', label: 'Para llevar' }, { value: 'delivery', label: 'Delivery' }]} />
    {list.length === 0 ? (
      <div className="card"><EmptyState icon={<Store size={40} />} title="No hay pedidos abiertos">Los pedidos de mostrador, para llevar y delivery aparecen acá hasta que se cobran.</EmptyState></div>
    ) : (
      <ul className="salon-counter" aria-label="Pedidos sin mesa">
        {list.map((t) => {
          const Icon = ICON[channelOf(t) as Counter];
          const st = stage(t);
          return (
            <li key={t.id}>
              <button type="button" className={`salon-ticket-card tone-${st.tone || 'none'}`} onClick={() => onOpen(t.id)} aria-label={`${ticketLabel(t)}: ${st.label}`}>
                <span className="salon-ticket-top"><Icon size={18} aria-hidden /><b>{ticketLabel(t)}</b><span className="num salon-ticket-no">#{t.number}</span></span>
                {t.customer?.address && <span className="small truncate">{t.customer.address}</span>}
                <span className="salon-ticket-bottom"><span className={`salon-stage tone-${st.tone || 'none'}`}>{st.label}</span><span className="small muted">{sinceLabel(t.openedAt, now)}</span><b className="num">{fmtMoney(t.total)}</b></span>
              </button>
            </li>
          );
        })}
      </ul>
    )}
    {creating && <NewOrderModal channel={creating} onClose={() => setCreating(null)} onCreated={(id) => { setCreating(null); onOpen(id); }} />}
  </>);
}

function NewOrderModal({ channel, onClose, onCreated }: { channel: Counter; onClose: () => void; onCreated: (id: string) => void }) {
  const { run } = useFeedback();
  const [c, setC] = useState({ name: '', phone: '', address: '' });
  const [shipping, setShipping] = useState<number | undefined>();
  const go = async () => {
    const t = await run(() => openCounterTicket(channel, c, channel === 'delivery' ? shipping : undefined));
    if (t) onCreated(t.id);
  };
  return (
    <Modal open title={`Nuevo pedido · ${CHANNEL_LABEL[channel]}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void go()}><Plus size={18} aria-hidden /> Empezar pedido</button></>}>
      <form className="form-grid cols-2" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <Field label={channel === 'mostrador' ? 'Nombre (opcional)' : 'Nombre'}><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} data-autofocus /></Field>
        <Field label="Teléfono (opcional)"><Input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} inputMode="tel" /></Field>
        {channel === 'delivery' && <Field label="Dirección"><Input value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} /></Field>}
        {channel === 'delivery' && <Field label="Envío (opcional)"><NumberInput value={shipping} onChange={setShipping} min={0} /></Field>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import { BellRing, Clock, Map as MapIcon, Pencil, Plus, Receipt, Search, Trash2, UtensilsCrossed } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { db } from '../database/db';
import { EMPTY, useLookups, useProducts } from '../hooks/useData';
import { useCosts } from '../hooks/useCosts';
import { dishCost, type DishCost } from '../services/menuCostService';
import { RecipeEditor } from '../components/RecipeEditor';
import { minutesSince, sinceLabel, useNow } from '../hooks/useNow';
import { useToday, startOfDayIso } from '../hooks/useToday';
import type { DiningTable, FiscalDoc, IvaRate, MenuExtra, MenuItem, Recipe, Station, TableTicket } from '../models';
import { CBTE_NAME, IVA_RATES, PAYMENT_LABEL, docNumber, fiscalOf } from '../services/fiscalService';
import { KITCHEN_WARN_MIN, addNumberedTables, channelOf, discountAmount, openTicket, retireTable, saveMenuItem, saveTable, ticketLabel, waitingSince } from '../services/salonService';
import { useFeedback } from '../store/feedback';
import { useSession } from '../store/session';
import { Badge, EmptyState, Field, Input, NumberInput, PageHeader, Segmented, Select } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { CloudRulesNote } from '../components/salon/CloudRulesNote';
import { ChargeModal } from '../components/salon/ChargeModal';
import { TicketSheet } from '../components/salon/TicketSheet';
import { FloorPlan, STATE_LABEL, tableState } from '../components/salon/FloorPlan';
import { CounterTab } from '../components/salon/CounterTab';
import { CashTab } from '../components/salon/CashTab';
import { AccountsTab } from '../components/salon/AccountsTab';
import { SalesReports } from '../components/salon/SalesReports';
import { DayCloseModal } from '../components/salon/DayCloseModal';
import { SaleActions } from '../components/salon/SaleEditor';
import { useMenu, useOpenCash, useOpenTickets, useTables } from '../components/salon/hooks';
import { SALON_VIEWS, type SalonView } from '../layouts/modules';
import { useSettings } from '../store/settings';
import { fmtMoney, fmtTime, matches } from '../utils/format';

type Tab = SalonView;
const TITLE: Record<Tab, { title: string; sub: string }> = {
  mesas: { title: 'Mesas', sub: 'Plano del salón: tocá una mesa para abrirla o ver su pedido.' },
  mostrador: { title: 'Mostrador', sub: 'Pedidos de mostrador, para llevar y delivery.' },
  caja: { title: 'Caja', sub: 'Apertura, ingresos y egresos, propinas y arqueo.' },
  cuentas: { title: 'Cuentas corrientes', sub: 'Lo que debe cada cliente (ALADES, socios, personal…) y sus pagos.' },
  carta: { title: 'Carta', sub: 'Lo que se vende en el salón: precios, secciones y adicionales.' },
  hoy: { title: 'Ventas de hoy', sub: 'Pedidos del día, lo cobrado y lo más pedido. Tocá un pedido para ver el detalle o corregirlo.' },
  reportes: { title: 'Reportes de ventas', sub: 'Ventas por período, plato, día, hora, medio de pago, canal y mozo, con costo y margen.' },
};
type View = 'plano' | 'lista';
const VIEW_KEY = 'sm.salon.view';
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'lista' ? 'lista' : 'plano'; } catch { return 'plano'; } };

/**
 * Salón (estilo Fudo): plano de mesas, mostrador / para llevar / delivery, caja con arqueos,
 * carta con adicionales y lo del día. Cada pedido se abre en la misma hoja (carta, comanda,
 * descuentos, cortesías) y se cobra con división de cuenta, propina y factura ARCA.
 */
export function SalonPage() {
  const { can } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const v = params.get('vista');
  const tab: Tab = v && (SALON_VIEWS as readonly string[]).includes(v) ? (v as Tab) : 'mesas';
  const setTab = (t: Tab) => navigate(t === 'mesas' ? '/salon' : `/salon?vista=${t}`);
  const tables = useTables();
  const open = useOpenTickets();
  const cash = useOpenCash();
  const [sheet, setSheet] = useState<string | null>(null);
  const [charging, setCharging] = useState<TableTicket | null>(null);
  const tableTickets = open.filter((t) => channelOf(t) === 'mesa');
  const counter = open.filter((t) => channelOf(t) !== 'mesa');
  const byTable = useMemo(() => new Map(tableTickets.map((t) => [t.tableId, t])), [tableTickets]);
  const openTotal = open.reduce((s, t) => s + t.total, 0);
  const billing = can('billing') || can('admin');

  const status = tables.length || counter.length ? `${byTable.size} de ${tables.length} mesas ocupadas${counter.length ? ` · ${counter.length} sin mesa` : ''}${openTotal ? ` · ${fmtMoney(openTotal)} abierto` : ''}` : '';
  const subtitle = tab === 'mesas' || tab === 'mostrador' ? status || TITLE[tab].sub : tab === 'caja' ? (cash ? `Caja #${cash.number} abierta` : 'La caja está cerrada') : TITLE[tab].sub;

  return (
    <div className="salon">
      <PageHeader title={TITLE[tab].title} subtitle={subtitle} />
      <CloudRulesNote />
      {tab === 'mesas' && <TablesBoard tables={tables} byTable={byTable} onOpen={setSheet} onGoMenu={() => setTab('carta')} />}
      {tab === 'mostrador' && <CounterTab open={counter} onOpen={setSheet} />}
      {tab === 'caja' && (billing ? <CashTab /> : <div className="card card-pad"><p className="muted" style={{ margin: 0 }}>La caja la manejan quienes tienen permiso para cobrar.</p></div>)}
      {tab === 'cuentas' && (billing ? <AccountsTab /> : <div className="card card-pad"><p className="muted" style={{ margin: 0 }}>Las cuentas corrientes las manejan quienes tienen permiso para cobrar.</p></div>)}
      {tab === 'carta' && <MenuTab />}
      {tab === 'hoy' && <TodayTab />}
      {tab === 'reportes' && (billing ? <SalesReports /> : <div className="card card-pad"><p className="muted" style={{ margin: 0 }}>Los reportes los ven quienes tienen permiso para cobrar.</p></div>)}
      {sheet && <TicketSheet ticketId={sheet} onClose={() => setSheet(null)} onCharge={(t) => { setSheet(null); setCharging(t); }} tables={tables} busy={new Set(byTable.keys())} />}
      {charging && <ChargeModal ticket={charging} onClose={(closed) => { const t = charging; setCharging(null); if (!closed) setSheet(t.id); }} />}
    </div>
  );
}

// ───────────────────────── Mesas ─────────────────────────

function TablesBoard({ tables, byTable, onOpen, onGoMenu }: { tables: DiningTable[]; byTable: Map<string, TableTicket>; onOpen: (id: string) => void; onGoMenu: () => void }) {
  const { run } = useFeedback();
  const now = useNow();
  const menu = useMenu();
  const [zone, setZone] = useState('');
  const [manage, setManage] = useState(false);
  const [view, setViewState] = useState<View>(readView);
  const [editing, setEditing] = useState(false);
  const setView = (v: View) => { setViewState(v); setEditing(false); try { localStorage.setItem(VIEW_KEY, v); } catch { /* sin almacenamiento */ } };
  const zones = useMemo(() => [...new Set(tables.map((t) => t.zone))], [tables]);
  const curZone = zone && zones.includes(zone) ? zone : view === 'plano' ? zones[0] ?? '' : '';
  const shown = curZone ? tables.filter((t) => t.zone === curZone) : tables;
  const ready = [...byTable.values()].filter((t) => t.lines.some((l) => l.status === 'listo' && l.qty > 0));
  const late = [...byTable.values()].map((t) => ({ t, min: Math.floor(minutesSince(waitingSince(t), now)) })).filter((x) => x.min >= KITCHEN_WARN_MIN).sort((a, b) => b.min - a.min);

  if (!tables.length) return <FirstTables />;

  const tap = async (t: DiningTable) => {
    const current = byTable.get(t.id);
    if (current) return onOpen(current.id);
    const ticket = await run(() => openTicket(t.id));
    if (ticket) onOpen(ticket.id);
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
      {late.length > 0 && (
        <div className="salon-ready salon-late" role="status">
          <Clock size={18} aria-hidden />
          <span>Demora en cocina: {late.map((x) => `mesa ${x.t.tableName} (${x.min} min)`).join(', ')}</span>
        </div>
      )}
      <div className="salon-bar">
        {zones.length > 1 ? (
          <div className="group-chips" role="group" aria-label="Sector">
            {view === 'lista' && <button type="button" className="group-chip" aria-pressed={!curZone} onClick={() => setZone('')}>Todas</button>}
            {zones.map((z) => <button key={z} type="button" className="group-chip" aria-pressed={curZone === z} onClick={() => setZone(z)}>{z}</button>)}
          </div>
        ) : <span />}
        <div className="row" style={{ gap: 6 }}>
          <Segmented<View> label="Vista de mesas" value={view} onChange={setView} options={[{ value: 'plano', label: 'Plano' }, { value: 'lista', label: 'Lista' }]} />
          {view === 'plano' && <button type="button" className={`btn btn-sm${editing ? ' btn-primary' : ''}`} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>{editing ? 'Listo' : <><MapIcon size={16} aria-hidden /> Editar plano</>}</button>}
          <button type="button" className="btn btn-sm" onClick={() => setManage(true)}><Pencil size={16} aria-hidden /> Mesas</button>
        </div>
      </div>

      {view === 'plano' ? (
        <FloorPlan tables={shown} byTable={byTable} now={now} editing={editing} onTap={(t) => void tap(t)} />
      ) : (
        <ul className="salon-floor" aria-label="Mesas">
          {shown.map((t) => {
            const k = byTable.get(t.id);
            const state = tableState(k);
            const pending = k?.lines.filter((l) => l.qty > 0 && l.status === 'nuevo').length ?? 0;
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
      )}
      {manage && <TablesModal onClose={() => setManage(false)} tables={tables} busy={new Set(byTable.keys())} />}
    </>
  );
}

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

// ───────────────────────── Carta ─────────────────────────

type ItemDraft = { id?: string; name: string; section: string; price?: number; kitchen: boolean; active: boolean; iva?: IvaRate; extras: MenuExtra[]; recipe?: Recipe; station?: Station };

function MenuTab() {
  const menu = useMenu();
  const fiscal = fiscalOf(useSettings());
  const products = useProducts();
  const costs = useCosts();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const costOfItem = (m: MenuItem) => (costs.visible ? dishCost(m, costs.costOf, byId, fiscal) : undefined);
  const noRecipe = menu.filter((m) => m.active && !m.recipe?.items.length).length;
  const [edit, setEdit] = useState<ItemDraft | null>(null);
  const [q, setQ] = useState('');
  const sections = useMemo(() => [...new Set(menu.map((m) => m.section))].sort((a, b) => a.localeCompare(b, 'es')), [menu]);
  const list = q.trim() ? menu.filter((m) => matches(m.name, q) || matches(m.section, q)) : menu;
  const blank = (): ItemDraft => ({ name: '', section: sections[0] ?? 'Desayunos', kitchen: true, active: true, extras: [] });

  return (
    <>
      <div className="salon-bar">
        <label className="production-search salon-search">
          <Search size={20} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la carta" aria-label="Buscar en la carta" />
        </label>
        <button type="button" className="btn btn-primary" onClick={() => setEdit(blank())}><Plus size={18} aria-hidden /> Agregar a la carta</button>
      </div>
      {menu.length > 0 && noRecipe > 0 && <p className="small muted">{noRecipe} {noRecipe === 1 ? 'plato no tiene' : 'platos no tienen'} receta: sin receta no se descuenta stock al venderlos ni se sabe cuánto cuestan.</p>}

      {menu.length === 0 ? (
        <div className="card"><EmptyState icon={<UtensilsCrossed size={40} />} title="La carta está vacía" action={<button type="button" className="btn btn-primary" onClick={() => setEdit(blank())}><Plus size={18} aria-hidden /> Agregar el primero</button>}>
          Cargá lo que se vende en el salón: nombre, sección, precio y, si querés, adicionales.
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
                    <div className="list-sub">{m.kitchen ? 'Va a cocina' : 'Sale directo'}{m.extras?.length ? ` · ${m.extras.length} adicional${m.extras.length === 1 ? '' : 'es'}` : ''}{m.active ? '' : ' · pausado'}</div>
                  </div>
                  <span className="salon-menu-price">
                    <b className="num">{fmtMoney(m.price)}</b>
                    <CostTag c={costOfItem(m)} />
                  </span>
                  <button type="button" className="btn btn-ghost icon-btn" aria-label={`Editar ${m.name}`}
                    onClick={() => setEdit({ id: m.id, name: m.name, section: m.section, price: m.price, kitchen: m.kitchen, active: m.active, iva: m.iva, extras: m.extras ?? [], recipe: m.recipe, station: m.station })}><Pencil size={18} /></button>
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

/** Costo de la porción y qué porcentaje del precio (neto) se lleva. */
function CostTag({ c }: { c?: DishCost }) {
  if (!c) return null;
  if (c.cost === 0 && c.missing.length) return <span className="salon-cost small" title={`Sin costo: ${c.missing.join(', ')}`}>sin costo</span>;
  const tone = c.pct === undefined ? '' : c.pct > 40 ? ' is-high' : c.pct > 30 ? ' is-mid' : '';
  return <span className={`salon-cost small${tone}`} title={c.missing.length ? `Sin costo: ${c.missing.join(', ')}` : undefined}>costo {fmtMoney(c.cost)}{c.pct !== undefined ? ` · ${String(c.pct).replace('.', ',')}%` : ''}{c.missing.length ? ' *' : ''}</span>;
}

function MenuItemModal({ draft, sections, onClose }: { draft: ItemDraft; sections: string[]; onClose: () => void }) {
  const { run } = useFeedback();
  const fiscal = fiscalOf(useSettings());
  const [d, setD] = useState(draft);
  const products = useProducts();
  const lk = useLookups();
  const costs = useCosts();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const cost = costs.visible && d.recipe?.items.length ? dishCost({ price: d.price ?? 0, iva: d.iva, recipe: d.recipe }, costs.costOf, byId, fiscal) : undefined;
  const save = (again: boolean) => void run(async () => {
    await saveMenuItem({ ...d, price: d.price ?? NaN });
    if (again) setD({ ...d, id: undefined, name: '', price: undefined, extras: [], recipe: undefined });
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
        {d.kitchen && <Segmented<Station> label="Lo prepara" value={d.station ?? 'cocina'} onChange={(v) => setD({ ...d, station: v })} options={[{ value: 'cocina', label: 'Cocina' }, { value: 'barra', label: 'Barra (cafés, tragos)' }]} />}
        <fieldset className="salon-extras-edit">
          <legend>Adicionales (opcional)</legend>
          {d.extras.map((e, i) => (
            <div key={i} className="salon-extra-row">
              <Input aria-label={`Adicional ${i + 1}`} value={e.name} placeholder="Ej.: leche de almendras" onChange={(ev) => setD({ ...d, extras: d.extras.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)) })} />
              <NumberInput aria-label={`Precio del adicional ${i + 1}`} value={e.price} min={0} onChange={(v) => setD({ ...d, extras: d.extras.map((x, j) => (j === i ? { ...x, price: v ?? 0 } : x)) })} />
              <button type="button" className="btn btn-ghost icon-btn" aria-label={`Quitar adicional ${i + 1}`} onClick={() => setD({ ...d, extras: d.extras.filter((_, j) => j !== i) })}><Trash2 size={18} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setD({ ...d, extras: [...d.extras, { name: '', price: 0 }] })}><Plus size={16} aria-hidden /> Agregar adicional</button>
        </fieldset>
        <RecipeEditor value={d.recipe} onChange={(r) => setD({ ...d, recipe: r })} products={products} lk={lk} unit="porción" perPortion
          legend={<>Receta de una porción <span className="muted small">— opcional: al vender se descuenta del stock y da el costo del plato</span></>} />
        {cost && (
          <div className="salon-dish-cost" role="status" aria-label="Costo del plato">
            <span>Costo <b className="num">{fmtMoney(cost.cost)}</b></span>
            <span>{fiscal.enabled && fiscal.condicionIva === 'RI' ? 'Precio sin IVA' : 'Precio'} <b className="num">{fmtMoney(cost.net)}</b></span>
            <span>Margen <b className="num">{fmtMoney(cost.margin)}</b>{cost.pct !== undefined ? ` (costo ${String(cost.pct).replace('.', ',')}%)` : ''}</span>
            {cost.missing.length > 0 && <span className="small" style={{ color: 'var(--low)' }}>Sin costo: {cost.missing.join(', ')} (cargalo en el producto o con una factura).</span>}
          </div>
        )}
        {d.id && <label className="check"><input type="checkbox" checked={!d.active} onChange={(e) => setD({ ...d, active: !e.target.checked })} /> Pausado (no se puede pedir)</label>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ───────────────────────── Hoy ─────────────────────────

function TodayTab() {
  const today = useToday();
  // Como en Fudo, se puede ver (y corregir) las ventas de otro día.
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const since = startOfDayIso(day);
  const until = useMemo(() => { const d = new Date(since); d.setDate(d.getDate() + 1); return d.toISOString(); }, [since]);
  const tickets = (useLiveQuery(() => db.tickets.where('openedAt').between(since, until, true, false).reverse().sortBy('openedAt'), [since, until]) ?? EMPTY) as TableTicket[];
  const [detail, setDetail] = useState<TableTicket | null>(null);
  const [closing, setClosing] = useState(false);
  const { can } = useSession();
  const closed = tickets.filter((t) => t.status === 'cerrada');
  const discounts = closed.reduce((s, t) => s + discountAmount(t.subtotal ?? t.total, t.discount), 0);
  const tips = closed.reduce((s, t) => s + (t.charges ?? []).reduce((x, c) => x + (c.tip?.amount ?? 0), 0), 0);
  const sold = closed.reduce((s, t) => s + t.total, 0);
  const guests = closed.reduce((s, t) => s + (t.guests ?? 0), 0);
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
      <div className="salon-bar" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <Field label="Día"><Input type="date" value={day} max={today} onChange={(e) => setPicked(e.target.value && e.target.value !== today ? e.target.value : null)} /></Field>
        {(can('billing') || can('admin')) && day === today && <button type="button" className="btn" onClick={() => setClosing(true)}><Receipt size={18} aria-hidden /> Cierre del día</button>}
      </div>
      {closing && <DayCloseModal onClose={() => setClosing(false)} />}
      <div className="salon-stats">
        <div className="salon-stat"><span className="num">{fmtMoney(sold)}</span><span>vendido</span></div>
        <div className="salon-stat"><span className="num">{closed.length}</span><span>{closed.length === 1 ? 'pedido cerrado' : 'pedidos cerrados'}</span></div>
        <div className="salon-stat"><span className="num">{closed.length ? fmtMoney(sold / closed.length) : '—'}</span><span>promedio por pedido</span></div>
        <div className="salon-stat"><span className="num">{guests || '—'}</span><span>comensales</span></div>
      </div>
      {byMethod.size > 0 && (
        <p className="small salon-caja"><b>Cobrado:</b> {[...byMethod.entries()].map(([m, v]) => `${PAYMENT_LABEL[m as keyof typeof PAYMENT_LABEL]} ${fmtMoney(v)}`).join(' · ')}{tips ? ` · propinas ${fmtMoney(tips)}` : ''}{discounts ? ` · descuentos ${fmtMoney(discounts)}` : ''}</p>
      )}

      {tickets.length === 0 ? (
        <div className="card"><EmptyState icon={<Receipt size={40} />} title={day === today ? 'Todavía no hubo mesas hoy' : 'No hubo ventas ese día'}>{day === today ? 'Cuando se abra la primera mesa aparece acá.' : 'Elegí otro día.'}</EmptyState></div>
      ) : (
        <div className="salon-today">
          <section className="card" aria-labelledby="salon-today-list">
            <div className="card-head"><h2 id="salon-today-list">{day === today ? 'Pedidos de hoy' : 'Pedidos del día'}</h2><span className="small muted">tocá uno para ver el detalle o corregirlo</span></div>
            <ul className="list">
              {tickets.map((t) => (
                <li key={t.id} className="list-item">
                  <button type="button" className="list-btn grow" onClick={() => setDetail(t)}>
                    <span className="list-title">{ticketLabel(t)} · #{t.number}</span>
                    <span className="list-sub">{fmtTime(t.openedAt)}{t.closedAt ? `–${fmtTime(t.closedAt)}` : ''}{t.openedBy ? ` · ${t.openedBy.name}` : ''} · {t.lines.filter((l) => l.qty > 0).reduce((s, l) => s + l.qty, 0)} ítems</span>
                  </button>
                  <span className="salon-today-right">
                    <b className="num">{fmtMoney(t.total)}</b>
                    {t.status === 'cerrada' && (t.charges ?? []).filter((c) => c.fiscalDocId).length > 1 ? <Badge tone="ok">{(t.charges ?? []).filter((c) => c.fiscalDocId && docOf.get(c.fiscalDocId)?.status === 'autorizada').length} facturas</Badge>
                      : t.status === 'cerrada' && t.fiscalDocId && docOf.get(t.fiscalDocId) ? <FiscalBadge d={docOf.get(t.fiscalDocId)!} />
                      : t.status === 'cerrada' && t.fiscalPending ? <Badge tone="warn">Sin facturar</Badge>
                      : t.status === 'cerrada' ? <Badge tone="ok">Cobrado</Badge>
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

function TicketDetail({ ticket: first, onClose }: { ticket: TableTicket; onClose: () => void }) {
  // La venta en vivo: si se cambia (medio de pago, datos, anular), el detalle se actualiza.
  const ticket = useLiveQuery(() => db.tickets.get(first.id), [first.id]) ?? first;
  return (
    <Modal open title={`${ticketLabel(ticket)} · #${ticket.number}${ticket.status === 'anulada' ? ' · ANULADA' : ''}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Abierta {fmtTime(ticket.openedAt)}{ticket.closedAt ? `, cerrada ${fmtTime(ticket.closedAt)}` : ''}{ticket.openedBy ? ` · ${ticket.openedBy.name}` : ''}{ticket.guests ? ` · ${ticket.guests} comensales` : ''}</p>
      <ul className="salon-lines">
        {ticket.lines.map((l) => (
          <li key={l.id} className={`salon-line${l.qty === 0 ? ' is-void' : ''}`}>
            <b className="salon-qty-fixed num">{l.qty ? `${l.qty}×` : '—'}</b>
            <span className="grow salon-line-text"><span className="salon-line-name">{l.name}{l.qty === 0 && <span className="small"> · anulado</span>}</span>{l.notes && <span className="salon-line-note">{l.notes}</span>}</span>
            <span className="num salon-line-price">{l.comp ? 'cortesía' : l.qty ? fmtMoney(l.qty * l.price) : ''}</span>
          </li>
        ))}
      </ul>
      {ticket.discount && <p className="small" style={{ textAlign: 'right' }}>Descuento −{fmtMoney(discountAmount(ticket.subtotal ?? ticket.total, ticket.discount))}{ticket.discount.reason ? ` (${ticket.discount.reason})` : ''}</p>}
      <div className="salon-total"><span>Total</span><b className="num">{fmtMoney(ticket.total)}</b></div>
      {(ticket.charges ?? []).length > 0 && (
        <ul className="small charge-list">
          {ticket.charges!.map((c) => <li key={c.id}>{fmtTime(c.at)} · {c.label ?? 'Cobro'}: {c.payments.map((p) => `${PAYMENT_LABEL[p.method]} ${fmtMoney(p.amount)}`).join(' + ')}{c.tip ? ` · propina ${fmtMoney(c.tip.amount)}` : ''}{c.by ? ` · ${c.by.name}` : ''}</li>)}
        </ul>
      )}
      <SaleActions ticket={ticket} onDone={(t) => { if (t.status === 'abierta') onClose(); }} />
      <p className="small muted">Para ver lo que cocina tiene pendiente, abrí <Link to="/cocina">Cocina</Link>.</p>
    </Modal>
  );
}

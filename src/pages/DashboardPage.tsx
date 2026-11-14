import { AlertTriangle, Armchair, Boxes, Camera, ChefHat, CheckCircle2, ChevronRight, ClipboardCheck, CookingPot, DollarSign, Lock, LogOut, MinusCircle, Package, Receipt, Snowflake, Sparkles, Store, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../database/db';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { EMPTY, useProducts } from '../hooks/useData';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { MODULE_PERMISSIONS, menuGroups, moduleOn, visibleModules, writeArea } from '../layouts/modules';
import { useMenu, useOpenCash, useOpenTickets, useTables } from '../components/salon/hooks';
import { Bars, Hours } from '../components/salon/SalesReports';
import { salesReport, type SalesReport } from '../services/salesReportService';
import { PAYMENT_LABEL } from '../services/fiscalService';
import { channelOf } from '../services/salonService';
import { PERMISSIONS, type ModuleKey, type Permission, type TableTicket } from '../models';
import { useAssistantAvailable } from '../store/assistant';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { WelcomeCard } from '../components/WelcomeCard';
import { BakeryTodayCard, RestockCard, useHomePanels, type HomePanels, type Tone } from '../components/dashboard/HomePanels';
import { AttentionCard } from '../components/dashboard/AttentionCard';
import { negativeProducts } from '../services/attentionService';
import { fmtMoneyShort, fmtNumber } from '../utils/format';
import { inLocal, useLocalScope } from '../services/localScope';
import { LocalsOverview } from '../components/locales/LocalsOverview';

/**
 * Inicio, organizado como Fudo: arriba los accesos de todos los días (Mesas, Mostrador, Cocina,
 * Caja y lo del stock), después "Hoy" con las ventas del día y el estado del negocio (cada dato es
 * un botón), los gráficos del día (por hora, medios de pago, lo más vendido) y el menú completo
 * agrupado como en Fudo: Ventas, Productos, Stock (lo propio de Orillas), Compras y gastos,
 * Reportes y Administración. Al final, lo que hay que resolver. Todo según los permisos.
 */
export function DashboardPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const { user, canAny, can, lock, cloudMode } = useSession();
  const settings = useSettings();
  const products = useProducts();
  const d = useHomePanels();
  const assistantOn = useAssistantAvailable();
  const [negOpen, setNegOpen] = useState(false);
  const allowed = (m: ModuleKey) => moduleOn(settings, m) && canAny(MODULE_PERMISSIONS[m]);
  const actions = ACTIONS.filter((a) => canAny(a.perms) && (!a.module || moduleOn(settings, a.module)) && (a.to !== '/asistente' || assistantOn))
    // Con la lectura con IA configurada, la foto de factura ya abre con la IA.
    .map((a) => (a.to === '/facturas?nueva=1' && settings.aiReaderUrl ? { ...a, to: '/facturas?nueva=1&ia=1', hint: 'La IA lee los productos' } : a));

  const bakery = allowed('production') && <BakeryTodayCard key="b" d={d} limit={desktop ? 6 : 4} />;
  const restock = allowed('stock') && <RestockCard key="r" d={d} limit={desktop ? 6 : 4} />;
  const attention = (allowed('stock') || allowed('invoices') || allowed('count')) && (
    <AttentionCard key="t" hideNegatives={allowed('stock')} negOpen={negOpen} onNegOpen={setNegOpen} />
  );
  const day = [bakery, restock].filter(Boolean);

  return (
    <div className="hm">
      <Top name={user?.name ?? ''} business={settings.businessName} />

      {products.length === 0 && can('catalog.manage') && <WelcomeCard />}

      {/* En la computadora los accesos están en la barra de arriba (como Fudo). */}
      {!desktop && actions.length > 0 && (
        <section className="hm-block" aria-labelledby="hm-actions-title">
          <h2 id="hm-actions-title" className="sr-only">Acciones rápidas</h2>
          <nav className="hm-actions hm-quick" aria-label="Acciones rápidas">
            {actions.map(({ label, hint, to, icon: Icon, tone }) => (
              <Link key={label} to={to} className="hm-action">
                <span className={`hm-action-icon tone-${tone}`}><Icon size={22} aria-hidden /></span>
                <span className="hm-action-text">
                  <span className="hm-action-label">{label}</span>
                  <span className="hm-action-hint">{hint}</span>
                </span>
              </Link>
            ))}
          </nav>
        </section>
      )}

      {canAny(['admin']) && allowed('salon') && <LocalsOverview />}
      <NowStrip d={d} allowed={allowed} onNegatives={() => setNegOpen(true)} />

      {allowed('salon') && canAny(['billing', 'admin']) && <TodayCharts />}

      {!desktop && <MenuMap />}

      {attention}

      {day.length > 0 && <div className={`hm-grid ${day.length > 1 && desktop ? '' : 'is-single'}`}>{day}</div>}

      {!desktop && (
        <button type="button" className="btn btn-block hm-logout" onClick={() => void lock()}>
          {cloudMode ? <><LogOut size={18} aria-hidden /> Cerrar sesión</> : <><Lock size={18} aria-hidden /> Bloquear / cambiar usuario</>}
        </button>
      )}
    </div>
  );
}

// ───────────────────────── Ahora ─────────────────────────

/** Cómo está todo en este momento: cada dato lleva a donde se resuelve. */
function NowStrip({ d, allowed, onNegatives }: { d: HomePanels; allowed: (m: ModuleKey) => boolean; onNegatives: () => void }) {
  const { canAny } = useSession();
  const products = useProducts();
  const negatives = useMemo(() => negativeProducts(products).length, [products]);
  const salon = allowed('salon');
  const tables = useTables();
  const open = useOpenTickets();
  const cash = useOpenCash();
  const busy = new Set(open.filter((t) => t.tableId && channelOf(t) === 'mesa').map((t) => t.tableId)).size;
  const counter = open.filter((t) => channelOf(t) !== 'mesa').length;
  const cooking = open.reduce((n, t) => n + t.lines.filter((l) => l.status === 'cocina' && l.qty > 0).length, 0);
  const sinceCash = cash ? (cash.openedAt ? new Date(cash.openedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '') : '';
  const items: ReactNode[] = [];
  const sales = useTodaySales(salon && canAny(['billing', 'admin']));
  if (sales) {
    items.push(<NowItem key="vend" to="/salon?vista=hoy" icon={DollarSign} value={fmtMoneyShort(sales.sold)} label="vendido hoy" big />);
    items.push(<NowItem key="vtas" to="/salon?vista=hoy" icon={Receipt} value={String(sales.orders)} label={sales.orders === 1 ? 'venta' : 'ventas'} />);
    items.push(<NowItem key="prom" to="/salon?vista=reportes" icon={TrendingUp} value={sales.orders ? fmtMoneyShort(sales.avg) : '—'} label="ticket promedio" />);
    if (sales.guests) items.push(<NowItem key="com" to="/salon?vista=reportes" icon={Users} value={String(sales.guests)} label="comensales" />);
  }
  if (salon) {
    items.push(<NowItem key="mesas" to="/salon" icon={Armchair} value={tables.length ? `${busy} de ${tables.length}` : '—'} label={tables.length ? 'mesas ocupadas' : 'Armar las mesas'} />);
    if (counter) items.push(<NowItem key="most" to="/salon?vista=mostrador" icon={Store} value={String(counter)} label={counter === 1 ? 'pedido de mostrador' : 'pedidos de mostrador'} />);
  }
  if (allowed('kitchen')) items.push(<NowItem key="coc" to="/cocina" icon={CookingPot} value={String(cooking)} label={cooking === 1 ? 'plato en cocina' : 'platos en cocina'} tone={cooking ? 'warn' : undefined} />);
  if (salon && canAny(['billing', 'admin'])) items.push(<NowItem key="caja" to="/salon?vista=caja" icon={Wallet} value={cash ? 'Abierta' : 'Cerrada'} label={cash ? `caja desde las ${sinceCash}` : 'caja · tocá para abrir'} tone={cash ? 'ok' : undefined} />);
  if (allowed('stock')) {
    items.push(negatives > 0 ? (
      <button key="neg" type="button" className="hm-now is-crit" aria-haspopup="dialog" onClick={onNegatives}>
        <MinusCircle size={24} aria-hidden />
        <span className="hm-now-text"><span className="hm-now-value num">{fmtNumber(negatives)}</span><span className="hm-now-label">en negativo · ver por qué</span></span>
      </button>
    ) : (
      <NowItem key="neg" to="/stock" icon={CheckCircle2} value="0" label="en negativo" tone="ok" />
    ));
    items.push(<NowItem key="rep" to="/stock?estado=bajo" icon={AlertTriangle} value={fmtNumber(d.restock.length)} label="para reponer" tone={d.restock.length ? 'warn' : undefined} />);
  }
  if (allowed('showcase')) items.push(<NowItem key="cam" to="/camara" icon={Snowflake} value={fmtNumber(d.available.length)} label="en la cámara" />);
  if (!items.length) return null;
  return (
    <section className="hm-block" aria-labelledby="hm-now-title">
      <h2 id="hm-now-title" className="hm-block-title">Hoy</h2>
      <div className="hm-now-grid">{items}</div>
    </section>
  );
}

function NowItem({ to, icon: Icon, value, label, tone, big }: { to: string; icon: LucideIcon; value: string; label: string; tone?: 'ok' | 'warn'; big?: boolean }) {
  return (
    <Link to={to} className={`hm-now${tone ? ` is-${tone}` : ''}${big ? ' is-big' : ''}`}>
      <Icon size={24} aria-hidden />
      <span className="hm-now-text"><span className="hm-now-value num">{value}</span><span className="hm-now-label">{label}</span></span>
    </Link>
  );
}

// ───────────────────────── Ventas del día ─────────────────────────

const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Ventas de hoy (pedidos cerrados hoy). null si esta persona no las puede ver. */
function useTodaySales(enabled: boolean): SalesReport | null {
  const since = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 1); return d.toISOString(); }, []);
  const lid = useLocalScope().current?.id;
  const tickets = (useLiveQuery(() => (enabled ? db.tickets.where('openedAt').aboveOrEqual(since).filter(inLocal).toArray() : []), [enabled, since, lid]) ?? EMPTY) as TableTicket[];
  const menu = useMenu();
  return useMemo(() => {
    if (!enabled) return null;
    const day = todayYmd();
    return salesReport(tickets, { from: day, to: day }, { menu: new Map(menu.map((m) => [m.id, m])), payLabel: PAYMENT_LABEL });
  }, [enabled, tickets, menu]);
}

/** Gráficos del día, como el inicio de Fudo: ventas por hora, medios de pago y lo más vendido. */
function TodayCharts() {
  const r = useTodaySales(true);
  if (!r || !r.orders) return null;
  return (
    <section className="hm-block" aria-labelledby="hm-charts-title">
      <h2 id="hm-charts-title" className="hm-block-title">Ventas de hoy</h2>
      <div className="sales-grid hm-charts">
        <Hours rows={r.byHour} />
        <Bars id="hm-pay" title="Medios de pago" rows={r.byPayment} />
        <Bars id="hm-top" title="Lo más vendido" rows={r.items.slice(0, 6).map((i) => ({ key: i.key, label: `${fmtNumber(i.qty)} × ${i.name}`, count: i.qty, total: i.revenue }))} />
      </div>
    </section>
  );
}

// ───────────────────────── Menú completo (como Fudo) ─────────────────────────

function MenuMap() {
  const settings = useSettings();
  const { canAny } = useSession();
  const list = menuGroups(settings, visibleModules(settings, canAny), canAny)
    .map((g) => ({ ...g, entries: g.entries.filter((e) => e.key !== 'resumen') })).filter((g) => g.entries.length);
  if (!list.length) return null;
  return (
    <section className="hm-block" aria-labelledby="hm-menu-title">
      <h2 id="hm-menu-title" className="hm-block-title">Menú</h2>
      <div className="hm-map">
        {list.map((g) => (
          <nav key={g.key} className={`hm-map-group is-${g.key}`} aria-label={`Menú: ${g.label}`}>
            <h3 className="hm-map-title">{g.label}</h3>
            {g.entries.map((e) => (
              <Link key={e.key} to={e.to} className="hm-map-link" onClick={() => writeArea(e.area)}>
                <e.icon size={20} aria-hidden />
                <span>{e.label}</span>
                <ChevronRight size={18} aria-hidden className="hm-map-chev" />
              </Link>
            ))}
          </nav>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────── Encabezado ─────────────────────────

function greeting(h = new Date().getHours()) {
  if (h >= 5 && h < 13) return 'Buen día';
  if (h >= 13 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

function Top({ name, business }: { name: string; business: string }) {
  const date = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const first = name.split(' ')[0] ?? '';
  return (
    <header className="hm-top">
      {name && <span className="hm-avatar" aria-hidden>{initials(name)}</span>}
      <div className="hm-top-text">
        <p className="hm-top-meta">{date}{business ? ` · ${business}` : ''}</p>
        <h1>{greeting()}{first ? `, ${first}` : ''}</h1>
      </div>
    </header>
  );
}

// ───────────────────────── Accesos e indicadores ─────────────────────────

interface Action { label: string; hint: string; to: string; icon: LucideIcon; tone: Tone; perms: Permission[]; module?: ModuleKey }

const ACTIONS: Action[] = [
  { label: 'Mesas', hint: 'Plano y pedidos', to: '/salon', icon: Armchair, tone: 'petrol', perms: MODULE_PERMISSIONS.salon, module: 'salon' },
  { label: 'Mostrador', hint: 'Para llevar y delivery', to: '/salon?vista=mostrador', icon: Store, tone: 'petrol', perms: MODULE_PERMISSIONS.salon, module: 'salon' },
  { label: 'Cocina', hint: 'Comandas', to: '/cocina', icon: CookingPot, tone: 'amber', perms: MODULE_PERMISSIONS.kitchen, module: 'kitchen' },
  { label: 'Caja', hint: 'Abrir, cerrar, arqueo', to: '/salon?vista=caja', icon: Wallet, tone: 'emerald', perms: ['billing', 'admin'], module: 'salon' },
  { label: 'Anotar producción', hint: 'Lo que salió del horno', to: '/produccion', icon: ChefHat, tone: 'emerald', perms: ['production'], module: 'production' },
  { label: 'Cámara', hint: 'Lo congelado y lo que se saca', to: '/camara', icon: Snowflake, tone: 'blue', perms: MODULE_PERMISSIONS.showcase, module: 'showcase' },
  { label: 'Foto de factura', hint: 'Para el administrativo', to: '/facturas?nueva=1', icon: Camera, tone: 'amber', perms: ['invoices'], module: 'invoices' },
  { label: 'Contar stock', hint: 'Conteo o control', to: '/conteo', icon: ClipboardCheck, tone: 'petrol', perms: ['count.do'], module: 'count' },
  { label: 'Ver stock', hint: 'Existencias y alertas', to: '/stock', icon: Boxes, tone: 'slate', perms: ['stock.view'], module: 'stock' },
  { label: 'Productos', hint: 'Catálogo de productos', to: '/productos', icon: Package, tone: 'slate', perms: MODULE_PERMISSIONS.products, module: 'products' },
  { label: 'Asistente IA', hint: 'Preguntá o pedí cosas', to: '/asistente', icon: Sparkles, tone: 'petrol', perms: [...PERMISSIONS] },
];

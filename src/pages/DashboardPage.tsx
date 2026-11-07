import { AlertTriangle, Armchair, Boxes, Camera, ChefHat, CheckCircle2, ClipboardCheck, CookingPot, Lock, LogOut, MinusCircle, Package, Snowflake, Sparkles, Store, UtensilsCrossed, Wallet, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useProducts } from '../hooks/useData';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { MODULE_PATH, MODULE_PERMISSIONS, SALON_MODULES, moduleEnabled, navLabel, salonItems, visibleModules, visibleSections, writeArea } from '../layouts/modules';
import { useOpenCash, useOpenTickets, useTables } from '../components/salon/hooks';
import { channelOf } from '../services/salonService';
import { PERMISSIONS, type ModuleKey, type Permission } from '../models';
import { useAssistantAvailable } from '../store/assistant';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { WelcomeCard } from '../components/WelcomeCard';
import { BakeryTodayCard, RestockCard, useHomePanels, type HomePanels, type Tone } from '../components/dashboard/HomePanels';
import { AttentionCard } from '../components/dashboard/AttentionCard';
import { negativeProducts } from '../services/attentionService';
import { fmtNumber } from '../utils/format';

/**
 * Inicio: el tablero para entrar a todo. Arriba cómo está el negocio ahora (mesas, cocina, caja y
 * stock, cada dato es un botón que lleva ahí), después el menú completo con botones grandes —
 * primero el Salón y después el Stock—, las acciones rápidas y lo que hay que resolver hoy.
 * Todo según los permisos de cada persona.
 */
export function DashboardPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const { user, canAny, can, lock, cloudMode } = useSession();
  const settings = useSettings();
  const products = useProducts();
  const d = useHomePanels();
  const assistantOn = useAssistantAvailable();
  const [negOpen, setNegOpen] = useState(false);
  const allowed = (m: ModuleKey) => moduleEnabled(m) && canAny(MODULE_PERMISSIONS[m]);
  const actions = ACTIONS.filter((a) => canAny(a.perms) && (!a.module || moduleEnabled(a.module)) && (a.to !== '/asistente' || assistantOn))
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

      <NowStrip d={d} allowed={allowed} onNegatives={() => setNegOpen(true)} />

      <MainMenu />

      {actions.length > 0 && (
        <section className="hm-block" aria-labelledby="hm-actions-title">
          <h2 id="hm-actions-title" className="hm-block-title">Acciones rápidas</h2>
          <nav className="hm-actions" aria-label="Acciones rápidas">
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
      <h2 id="hm-now-title" className="hm-block-title">Ahora</h2>
      <div className="hm-now-grid">{items}</div>
    </section>
  );
}

function NowItem({ to, icon: Icon, value, label, tone }: { to: string; icon: LucideIcon; value: string; label: string; tone?: 'ok' | 'warn' }) {
  return (
    <Link to={to} className={`hm-now${tone ? ` is-${tone}` : ''}`}>
      <Icon size={24} aria-hidden />
      <span className="hm-now-text"><span className="hm-now-value num">{value}</span><span className="hm-now-label">{label}</span></span>
    </Link>
  );
}

// ───────────────────────── Menú completo ─────────────────────────

const SALON_HINT: Record<string, string> = {
  mesas: 'Plano, pedidos y cobro', mostrador: 'Mostrador, para llevar y delivery', cocina: 'Comandas de cocina y barra',
  caja: 'Abrir, cerrar y arqueo', carta: 'Platos, precios y recetas', hoy: 'Lo vendido hoy y el cierre del día',
  reportes: 'Ventas, platos, horas y mozos', comprobantes: 'Facturas ARCA y libro IVA', config: 'Facturación, mesas, impresión',
};
const STOCK_HINT: Record<string, string> = {
  stock: 'Existencias, conteos y movimientos', produccion: 'Lo que sale del horno', pasteleria: 'Tortas y pastelería',
  camara: 'Congelados y lo que se saca', productos: 'Catálogo, familias y recetas', compras: 'Facturas, pedidos y proveedores',
  config: 'Empresa, usuarios, nube y datos',
};

/** Todas las secciones con botones grandes: primero el Salón, después el Stock. */
function MainMenu() {
  const settings = useSettings();
  const { canAny } = useSession();
  const visible = visibleModules(settings, canAny);
  const salon = salonItems(visible, canAny).filter((i) => i.key !== 'inicio');
  const stock = visibleSections(settings, visible.filter((k) => !SALON_MODULES.has(k))).filter((s) => s.key !== 'inicio');
  if (!salon.length && !stock.length) return null;
  return (
    <>
      {salon.length > 0 && (
        <section className="hm-block" aria-labelledby="hm-menu-salon">
          <h2 id="hm-menu-salon" className="hm-block-title"><UtensilsCrossed size={20} aria-hidden /> Salón</h2>
          <nav className="hm-menu" aria-label="Menú del Salón">
            {salon.map((i) => (
              <Link key={i.key} to={i.to} className="hm-go" onClick={() => writeArea('salon')}>
                <span className="hm-go-icon"><i.icon size={26} aria-hidden /></span>
                <span className="hm-go-text"><span className="hm-go-label">{i.label}</span><span className="hm-go-hint">{SALON_HINT[i.key]}</span></span>
              </Link>
            ))}
          </nav>
        </section>
      )}
      {stock.length > 0 && (
        <section className="hm-block" aria-labelledby="hm-menu-stock">
          <h2 id="hm-menu-stock" className="hm-block-title"><Boxes size={20} aria-hidden /> Stock</h2>
          <nav className="hm-menu" aria-label="Menú del Stock">
            {stock.map((s) => (
              <div key={s.key} className="hm-go-wrap">
                <Link to={MODULE_PATH[s.tabs[0]]} className="hm-go" onClick={() => writeArea('stock')}>
                  <span className="hm-go-icon"><s.icon size={26} aria-hidden /></span>
                  <span className="hm-go-text"><span className="hm-go-label">{s.label}</span><span className="hm-go-hint">{STOCK_HINT[s.key]}</span></span>
                </Link>
                {s.tabs.length > 1 && (
                  <span className="hm-go-subs">
                    {s.tabs.slice(1).map((k) => <Link key={k} to={MODULE_PATH[k]} className="hm-sub" onClick={() => writeArea('stock')}>{navLabel(settings, k)}</Link>)}
                  </span>
                )}
              </div>
            ))}
          </nav>
        </section>
      )}
    </>
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
  { label: 'Anotar producción', hint: 'Lo que salió del horno', to: '/produccion', icon: ChefHat, tone: 'emerald', perms: ['production'], module: 'production' },
  { label: 'Cámara', hint: 'Lo congelado y lo que se saca', to: '/camara', icon: Snowflake, tone: 'blue', perms: MODULE_PERMISSIONS.showcase, module: 'showcase' },
  { label: 'Foto de factura', hint: 'Para el administrativo', to: '/facturas?nueva=1', icon: Camera, tone: 'amber', perms: ['invoices'], module: 'invoices' },
  { label: 'Contar stock', hint: 'Conteo o control', to: '/conteo', icon: ClipboardCheck, tone: 'petrol', perms: ['count.do'], module: 'count' },
  { label: 'Ver stock', hint: 'Existencias y alertas', to: '/stock', icon: Boxes, tone: 'slate', perms: ['stock.view'], module: 'stock' },
  { label: 'Productos', hint: 'Catálogo y recetas', to: '/productos', icon: Package, tone: 'slate', perms: MODULE_PERMISSIONS.products, module: 'products' },
  { label: 'Asistente IA', hint: 'Preguntá o pedí cosas', to: '/asistente', icon: Sparkles, tone: 'petrol', perms: [...PERMISSIONS] },
];

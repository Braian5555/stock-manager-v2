import { AlertTriangle, Boxes, Camera, ChefHat, ClipboardCheck, Lock, LogOut, Package, Receipt, Search, Store, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useProducts } from '../hooks/useData';
import { DESKTOP_QUERY, openGlobalSearch, useMediaQuery } from '../hooks/useMediaQuery';
import { MODULE_PERMISSIONS, moduleEnabled } from '../layouts/modules';
import type { ModuleKey, Permission, StockStatus } from '../models';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { WelcomeCard } from '../components/WelcomeCard';
import { useSyncView } from '../components/SyncBadge';
import {
  ActivityCard, BakeryTodayCard, InvoicesWeekCard, RestockCard, ShowcaseCard, useHomePanels, type HomePanels, type Tone,
} from '../components/dashboard/HomePanels';
import { fmtMoney, fmtNumber } from '../utils/format';

/**
 * Inicio: el día del negocio de un vistazo. Encabezado con saludo y resumen, accesos rápidos
 * (según los permisos de cada persona), indicadores y las secciones de panadería, vitrina,
 * reposición, facturas y actividad. Todo con datos reales y en vivo.
 */
export function DashboardPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const { user, canAny, can, lock, cloudMode } = useSession();
  const settings = useSettings();
  const products = useProducts();
  const d = useHomePanels();
  const allowed = (m: ModuleKey) => moduleEnabled(m) && canAny(MODULE_PERMISSIONS[m]);
  const actions = ACTIONS.filter((a) => canAny(a.perms) && (!a.module || moduleEnabled(a.module)));
  const kpis = buildKpis(d).filter((k) => allowed(k.module));

  const bakery = allowed('production') && <BakeryTodayCard key="b" d={d} limit={desktop ? 7 : 4} />;
  const activity = allowed('stock') && <ActivityCard key="a" d={d} limit={desktop ? 8 : 4} showLink={allowed('movements')} />;
  const restock = allowed('stock') && <RestockCard key="r" d={d} limit={desktop ? 6 : 4} />;
  const showcase = allowed('showcase') && <ShowcaseCard key="v" d={d} limit={desktop ? 6 : 4} />;
  const invoices = allowed('invoices') && <InvoicesWeekCard key="f" d={d} limit={desktop ? 5 : 3} />;
  const main = [bakery, activity].filter(Boolean);
  const side = [restock, showcase, invoices].filter(Boolean);
  // En el celular, primero lo urgente (reponer), después el día y la actividad.
  const mobileOrder = [restock, bakery, showcase, activity, invoices].filter(Boolean);

  return (
    <div className="hm">
      <Hero name={user?.name.split(' ')[0] ?? ''} business={settings.businessName} d={d} allowed={allowed} />

      {products.length === 0 && can('catalog.manage') && <WelcomeCard />}

      {!desktop && can('stock.view') && (
        <button type="button" className="hm-search" onClick={openGlobalSearch}>
          <Search size={19} aria-hidden /> Buscar producto, familia, ubicación…
        </button>
      )}

      {actions.length > 0 && (
        <nav className="hm-actions" aria-label="Acciones rápidas">
          {actions.map(({ label, hint, to, icon: Icon, tone }) => {
            const body = (<>
              <span className={`hm-action-icon tone-${tone}`}><Icon size={21} aria-hidden /></span>
              <span className="hm-action-text">
                <span className="hm-action-label">{label}</span>
                <span className="hm-action-hint">{hint}</span>
              </span>
            </>);
            return to
              ? <Link key={label} to={to} className="hm-action">{body}</Link>
              : <button key={label} type="button" className="hm-action is-search" onClick={openGlobalSearch}>{body}</button>;
          })}
        </nav>
      )}

      {kpis.length > 0 && (
        <div className="hm-kpis">
          {kpis.map((k) => (
            <Link key={k.label} to={k.to} className="hm-kpi">
              <span className="hm-kpi-top">
                <span className="hm-kpi-label">{k.label}</span>
                <span className={`hm-chip tone-${k.tone}`}><k.icon size={17} aria-hidden /></span>
              </span>
              <span className="hm-kpi-value num">{k.value}</span>
              <span className="hm-kpi-sub">{k.sub}</span>
              {k.meter}
            </Link>
          ))}
        </div>
      )}

      {desktop ? (
        (main.length > 0 || side.length > 0) && (
          <div className={`hm-grid ${main.length && side.length ? '' : 'is-single'}`}>
            {main.length > 0 && <div className="hm-col">{main}</div>}
            {side.length > 0 && <div className="hm-col">{side}</div>}
          </div>
        )
      ) : (
        mobileOrder.length > 0 && <div className="hm-col">{mobileOrder}</div>
      )}

      {!desktop && (
        <button type="button" className="btn btn-block hm-logout" onClick={() => void lock()}>
          {cloudMode ? <><LogOut size={18} aria-hidden /> Cerrar sesión</> : <><Lock size={18} aria-hidden /> Bloquear / cambiar usuario</>}
        </button>
      )}
    </div>
  );
}

// ───────────────────────── Encabezado ─────────────────────────

function greeting(h = new Date().getHours()) {
  if (h >= 5 && h < 13) return 'Buen día';
  if (h >= 13 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function Hero({ name, business, d, allowed }: { name: string; business: string; d: HomePanels; allowed: (m: ModuleKey) => boolean }) {
  const sync = useSyncView();
  const SyncIcon = sync.icon;
  const date = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  // Resumen con datos reales; sólo de lo que la persona puede ver.
  const facts: string[] = [];
  if (allowed('production')) facts.push(d.madeProducts ? `${d.madeProducts} ${d.madeProducts === 1 ? 'producto anotado' : 'productos anotados'} en panadería` : d.planned ? `${d.planned} ${d.planned === 1 ? 'producto' : 'productos'} en el plan de hoy` : 'Sin producción anotada hoy');
  if (allowed('showcase')) facts.push(`${d.available.length} en vitrina`);
  if (allowed('stock')) facts.push(d.restock.length ? `${d.restock.length} para reponer` : 'Nada para reponer');
  return (
    <header className="hm-hero">
      <div className="hm-hero-main">
        <p className="hm-hero-date">{date}</p>
        <h1>{greeting()}{name ? `, ${name}` : ''}</h1>
        {facts.length > 0 && (
          <ul className="hm-hero-facts" aria-label="Resumen de hoy">
            {facts.map((f) => <li key={f}>{f}</li>)}
          </ul>
        )}
      </div>
      <div className="hm-hero-side">
        <span className="hm-hero-business">{business}</span>
        <Link to="/nube" className={`hm-hero-sync is-${sync.tone}`} title={sync.detail}>
          <SyncIcon size={15} aria-hidden /> {sync.short}
        </Link>
      </div>
    </header>
  );
}

// ───────────────────────── Accesos e indicadores ─────────────────────────

interface Action { label: string; hint: string; to: string; icon: LucideIcon; tone: Tone; perms: Permission[]; module?: ModuleKey }

const ACTIONS: Action[] = [
  { label: 'Anotar producción', hint: 'Lo que salió del horno', to: '/produccion', icon: ChefHat, tone: 'emerald', perms: ['production'], module: 'production' },
  { label: 'Vitrina', hint: 'Lo que queda y lo vendido', to: '/vitrina', icon: Store, tone: 'blue', perms: MODULE_PERMISSIONS.showcase, module: 'showcase' },
  { label: 'Foto de factura', hint: 'Para el administrativo', to: '/facturas?nueva=1', icon: Camera, tone: 'amber', perms: ['invoices'], module: 'invoices' },
  { label: 'Contar stock', hint: 'Conteo o control', to: '/conteo', icon: ClipboardCheck, tone: 'petrol', perms: ['count.do'], module: 'count' },
  { label: 'Ver stock', hint: 'Existencias y alertas', to: '/stock', icon: Boxes, tone: 'slate', perms: ['stock.view'], module: 'stock' },
  { label: 'Productos', hint: 'Catálogo y recetas', to: '/productos', icon: Package, tone: 'slate', perms: MODULE_PERMISSIONS.products, module: 'products' },
  { label: 'Buscar producto', hint: 'También con Ctrl + K', to: '', icon: Search, tone: 'slate', perms: ['stock.view'] },
];

const HEALTH_ORDER: StockStatus[] = ['normal', 'bajo', 'critico', 'sin_stock'];
const HEALTH_LABEL: Record<StockStatus, string> = { normal: 'normal', bajo: 'bajo', critico: 'crítico', sin_stock: 'sin stock' };

function buildKpis(d: HomePanels) {
  const totalHealth = HEALTH_ORDER.reduce((s, k) => s + d.health[k], 0);
  return [
    {
      module: 'production' as ModuleKey, label: 'Panadería hoy', icon: ChefHat, tone: 'emerald' as Tone, to: '/produccion',
      value: fmtNumber(d.madeProducts),
      sub: d.planned ? `${d.done} de ${d.planned} del plan terminados` : d.madeProducts === 1 ? 'producto anotado' : 'productos anotados',
      meter: d.planned ? <span className="hm-meter" aria-hidden><span style={{ width: `${Math.round((d.done / d.planned) * 100)}%` }} /></span> : null,
    },
    {
      module: 'showcase' as ModuleKey, label: 'En vitrina', icon: Store, tone: 'blue' as Tone, to: '/vitrina',
      value: fmtNumber(d.available.length),
      sub: d.soldOut.length ? `${d.soldOut.length} ${d.soldOut.length === 1 ? 'agotado' : 'agotados'} hoy` : 'Nada agotado',
      meter: null,
    },
    {
      module: 'stock' as ModuleKey, label: 'Para reponer', icon: AlertTriangle, tone: 'amber' as Tone, to: '/stock?estado=bajo',
      value: fmtNumber(d.restock.length),
      sub: d.negatives ? `${d.negatives} en negativo` : d.restock.length ? 'Por debajo del mínimo' : 'Todo en orden',
      // Distribución real del stock activo por estado.
      meter: totalHealth ? (
        <span className="hm-health" title={HEALTH_ORDER.map((k) => `${d.health[k]} ${HEALTH_LABEL[k]}`).join(' · ')} aria-hidden>
          {HEALTH_ORDER.map((k) => d.health[k] > 0 && <span key={k} className={`h-${k}`} style={{ flexGrow: d.health[k] }} />)}
        </span>
      ) : null,
    },
    {
      module: 'invoices' as ModuleKey, label: 'Facturas · 7 días', icon: Receipt, tone: 'petrol' as Tone, to: '/facturas',
      value: fmtNumber(d.week.length),
      sub: d.week.length ? `${fmtMoney(d.weekTotal)} en total` : 'Ninguna esta semana',
      meter: null,
    },
  ];
}

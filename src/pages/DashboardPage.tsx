import { AlertTriangle, Boxes, Camera, ChefHat, CheckCircle2, ClipboardCheck, Lock, LogOut, MinusCircle, Package, Snowflake, Sparkles, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useProducts } from '../hooks/useData';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { MODULE_PERMISSIONS, moduleEnabled } from '../layouts/modules';
import { PERMISSIONS, type ModuleKey, type Permission } from '../models';
import { useAssistantAvailable } from '../store/assistant';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { WelcomeCard } from '../components/WelcomeCard';
import {
  ActivityCard, BakeryTodayCard, InvoicesWeekCard, PriceIncreasesCard, RestockCard, ShowcaseCard, useHomePanels, type HomePanels, type Tone,
} from '../components/dashboard/HomePanels';
import { AttentionCard } from '../components/dashboard/AttentionCard';
import { negativeProducts } from '../services/attentionService';
import { fmtNumber } from '../utils/format';

/**
 * Inicio: el día del negocio de un vistazo, en bloques. Arriba la producción de la semana, los
 * negativos, la vitrina y lo que hay que reponer; después "Para resolver", los accesos rápidos
 * (según los permisos de cada persona) y las secciones del día. Todo con datos reales y en vivo.
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

  const bakery = allowed('production') && <BakeryTodayCard key="b" d={d} limit={desktop ? 7 : 4} />;
  const activity = allowed('stock') && <ActivityCard key="a" d={d} limit={desktop ? 8 : 4} showLink={allowed('movements')} />;
  const restock = allowed('stock') && <RestockCard key="r" d={d} limit={desktop ? 6 : 4} />;
  const showcase = allowed('showcase') && <ShowcaseCard key="v" d={d} limit={desktop ? 6 : 4} />;
  const invoices = allowed('invoices') && <InvoicesWeekCard key="f" d={d} limit={desktop ? 5 : 3} />;
  const prices = allowed('invoices') && <PriceIncreasesCard key="p" limit={desktop ? 5 : 3} />;
  const attention = (allowed('stock') || allowed('invoices') || allowed('count')) && (
    <AttentionCard key="t" hideNegatives={allowed('stock')} negOpen={negOpen} onNegOpen={setNegOpen} />
  );
  const main = [bakery, activity].filter(Boolean);
  const side = [restock, showcase, invoices, prices].filter(Boolean);
  // En el celular, primero lo urgente (para resolver, reponer), después el día y la actividad.
  const mobileOrder = [restock, bakery, showcase, activity, invoices, prices].filter(Boolean);

  return (
    <div className="hm">
      <Top name={user?.name ?? ''} business={settings.businessName} />

      {products.length === 0 && can('catalog.manage') && <WelcomeCard />}

      <Bento d={d} allowed={allowed} onNegatives={() => setNegOpen(true)} />

      {attention}

      {actions.length > 0 && (
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

// ───────────────────────── Bloques (bento) ─────────────────────────

const DAY_INITIAL = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const dayOf = (ymd: string) => new Date(`${ymd}T12:00:00`);

function Bento({ d, allowed, onNegatives }: { d: HomePanels; allowed: (m: ModuleKey) => boolean; onNegatives: () => void }) {
  const products = useProducts();
  const negatives = useMemo(() => negativeProducts(products).length, [products]);
  const week = allowed('production');
  const stock = allowed('stock');
  const vitrina = allowed('showcase');
  if (!week && !stock && !vitrina) return null;
  const max = Math.max(1, ...d.weekDays.map((w) => w.qty));
  const todayBadge = d.planned ? `Hoy ${d.done} de ${d.planned}` : `Hoy ${d.madeProducts} ${d.madeProducts === 1 ? 'anotado' : 'anotados'}`;
  const pair = [
    vitrina && (
      <Link key="v" to="/camara" className="hm-mini">
        <span className="hm-mini-text"><span className="hm-mini-value num">{fmtNumber(d.available.length)}</span><span className="hm-mini-label">en la cámara</span></span>
        <Snowflake size={22} aria-hidden />
      </Link>
    ),
    stock && (
      <Link key="r" to="/stock?estado=bajo" className="hm-mini">
        <span className="hm-mini-text"><span className="hm-mini-value num">{fmtNumber(d.restock.length)}</span><span className="hm-mini-label">para reponer</span></span>
        <AlertTriangle size={22} aria-hidden />
      </Link>
    ),
  ].filter(Boolean);

  return (
    <div className={`hm-bento${stock ? '' : ' no-neg'}`}>
      {week && (
        <Link to="/produccion" className="hm-week">
          <span className="hm-week-head">
            <span className="hm-week-title">Producción · últimos 7 días</span>
            <span className="hm-week-badge">{todayBadge}</span>
          </span>
          <span className="hm-week-body">
            <span className="hm-week-total">
              <span className="hm-week-value num">{fmtNumber(d.weekProduced)}</span>
              <span className="hm-week-sub">{d.weekProduced ? 'anotado en la semana' : 'Todavía no se anotó producción'}</span>
            </span>
            <span className="hm-week-bars" aria-hidden>
              {d.weekDays.map((w, i) => (
                <span key={w.ymd} className={`hm-week-day${i === 6 ? ' is-today' : ''}`} title={`${dayOf(w.ymd).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' })}: ${fmtNumber(w.qty)}`}>
                  <span className="hm-week-bar" style={{ height: `${Math.max(6, Math.round((w.qty / max) * 100))}%` }} />
                  <span className="hm-week-letter">{DAY_INITIAL[dayOf(w.ymd).getDay()]}</span>
                </span>
              ))}
            </span>
          </span>
        </Link>
      )}
      {stock && (negatives > 0 ? (
        <button type="button" className="hm-neg" aria-haspopup="dialog" onClick={onNegatives}>
          <MinusCircle size={26} aria-hidden />
          <span className="hm-neg-text"><span className="hm-neg-value num">{fmtNumber(negatives)}</span><span className="hm-neg-label">en negativo</span><span className="hm-neg-hint">Tocá para ver por qué</span></span>
        </button>
      ) : (
        <Link to="/stock" className="hm-neg is-clear">
          <CheckCircle2 size={26} aria-hidden />
          <span className="hm-neg-text"><span className="hm-neg-value num">0</span><span className="hm-neg-label">en negativo</span><span className="hm-neg-hint">Todo el stock en positivo</span></span>
        </Link>
      ))}
      {pair.length > 0 && <div className={`hm-pair${pair.length === 1 ? ' is-one' : ''}`}>{pair}</div>}
    </div>
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

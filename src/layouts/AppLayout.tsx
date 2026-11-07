import { Boxes, ChevronLeft, CloudOff, LayoutGrid, LineChart, Package, Receipt, Search, Settings as SettingsIcon, Sparkles, UploadCloud, type LucideIcon } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { GlobalSearch } from '../components/GlobalSearch';
import { Logo } from '../components/Logo';
import { useIntegration, useOnline, usePendingJobs } from '../hooks/useData';
import { syncPending } from '../integrations/integrationService';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import {
  AREA_ICON, AREA_LABEL, MODULE_ICON, MODULE_PATH, SALON_MODULES, activeMenuKey, activeSalonItem, areaHome, areaOfModule, areasFor, bottomNavModules, menuGroups, moduleOfPath, navLabel, readArea, salonItems,
  soleModule, visibleModules, visibleSections, writeArea, type Area, type MenuEntry, type MenuGroup, type MenuGroupEntries, type SalonItem,
} from './modules';
import { useAutoSync } from '../hooks/useAutoSync';
import { SyncBadge } from '../components/SyncBadge';
import { UserMenu } from '../components/auth/UserMenu';
import { useSession } from '../store/session';
import { useAssistantAvailable } from '../store/assistant';
import type { ModuleKey } from '../models';

/**
 * Estructura de la app:
 * - Computadora (≥ 1024 px), como Fudo: barra de arriba con Salón, Mostrador, Cocina y Caja a mano
 *   y los grupos (Productos, Stock, Compras, Reportes, Configuración); debajo, las pantallas del grupo.
 * - Celular/tablet: encabezado compacto, pestañas de la sección y barra inferior fija (4 módulos + "Más").
 */
export function AppLayout() {
  const settings = useSettings();
  const online = useOnline();
  const pending = usePendingJobs();
  const integration = useIntegration();
  const { run } = useFeedback();
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  useAutoSync();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    const onOpen = () => setSearchOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('sm:open-search', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('sm:open-search', onOpen);
    };
  }, []);

  // Llaves obligatorias: en Chrome reciente scrollTo() devuelve una Promise y React
  // la trataría como función de limpieza ("l is not a function" al navegar).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const { canAny, can, user } = useSession();
  const visible = visibleModules(settings, canAny);
  const navigate = useNavigate();
  // Al entrar alguien que usa una sola sección (p. ej. el panadero), se abre directo esa.
  const single = soleModule(visible);
  useEffect(() => {
    // El asistente y la ayuda también los puede abrir.
    if (single && !visible.some((k) => location.pathname === MODULE_PATH[k]) && !/^\/(asistente|ayuda|acerca)/.test(location.pathname)) navigate(MODULE_PATH[single], { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar de usuario
  }, [user?.id, single]);
  const current = moduleOfPath(location.pathname);
  // Área (Stock o Salón): la de la pantalla actual; en pantallas comunes (asistente, ayuda), la última usada.
  const areas = areasFor(visible);
  const wanted: Area = areaOfModule(current) ?? readArea() ?? areas[0] ?? 'stock';
  const area: Area = areas.includes(wanted) ? wanted : areas[0] ?? 'stock';
  useEffect(() => { if (areaOfModule(current)) writeArea(area); }, [area, current]);
  const stockVisible = visible.filter((k) => !SALON_MODULES.has(k));
  const sections = area === 'stock' ? visibleSections(settings, stockVisible) : [];
  const section = sections.find((sec) => current && sec.tabs.includes(current));
  const salon = area === 'salon' ? salonItems(visible, canAny) : [];
  const salonActive = activeSalonItem(location.pathname, location.search);
  const salonCurrent = salon.find((i) => i.key === salonActive);
  const bottom = area === 'stock' ? bottomNavModules(settings, stockVisible) : [];
  const salonBottom = area === 'salon' ? pickSalonBottom(salon) : [];
  const home = areaHome(area, visible, canAny);
  const switchArea = (a: Area) => { writeArea(a); navigate(areaHome(a, visible, canAny)); };
  const connected = integration && integration.mode !== 'disabled' && integration.mode !== 'excel' && integration.status !== 'desconectado';
  const assistant = useAssistantAvailable();
  const menu = menuGroups(settings, visible, canAny);
  // El logo lleva al Salón (como Fudo); quien no usa el Salón vuelve a su inicio.
  const brandHome = areas.includes('salon') ? areaHome('salon', visible, canAny) : home;
  const activeKey = activeMenuKey(location.pathname, location.search);

  return (
    <div className="app">
      <a href="#contenido" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('contenido')?.focus(); }}>Saltar al contenido</a>
      <header className="topbar">
        <Link to={brandHome} className="brand" aria-label={`${settings.businessName} — ${brandHome === home && area !== 'salon' ? 'Inicio' : 'Salón'}`}>
          <Logo size={42} />
          <span className="brand-text">
            <span className="brand-name truncate">{settings.businessName}</span>
            {settings.subtitle && <span className="brand-sub truncate">{settings.subtitle}</span>}
          </span>
        </Link>

        {section && <span className="topbar-title truncate">{section.label}</span>}
        {salonCurrent && <span className="topbar-title truncate">{salonCurrent.label}</span>}
        <MainNav groups={menu} active={activeKey} />
        <span className="grow topbar-spacer" />
        {areas.length > 1 && <AreaSwitch area={area} onChange={switchArea} className="area-switch-top" />}
        {can('stock.view') && (
          <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Buscar (Ctrl+K)">
            <Search size={18} aria-hidden />
            <span className="search-trigger-text">Buscar…</span>
            <kbd className="search-trigger-kbd">Ctrl K</kbd>
          </button>
        )}
        {assistant && (
          <NavLink to="/asistente" className="asst-trigger" aria-label="Asistente IA" title="Asistente IA">
            <Sparkles size={18} aria-hidden />
            <span className="asst-trigger-text">Asistente</span>
          </NavLink>
        )}
        <SyncBadge compact />
        <UserMenu />
      </header>

      <SubNav groups={menu} active={activeKey} />
      {/* Configuración no lleva pestañas: todo se elige desde sus tarjetas (antes estaba repetido arriba y abajo). */}
      {section && section.key !== 'config' && section.tabs.length > 1 && <SectionTabs tabs={section.tabs} label={section.label} />}

      <UpdatePrompt />
      {!online && (
        <div className="banner banner-offline" role="status">
          <CloudOff size={16} aria-hidden /> Sin conexión. Podés seguir trabajando: todo se guarda en este dispositivo.
        </div>
      )}
      {online && connected && pending > 0 && (
        <div className="banner banner-offline" role="status">
          <UploadCloud size={16} aria-hidden />
          <span className="grow">Movimientos pendientes de sincronizar: {pending}</span>
          <button type="button" className="btn btn-sm" onClick={() => run(syncPending, 'Sincronización de pendientes finalizada')}>
            Sincronizar pendientes
          </button>
        </div>
      )}

      <main id="contenido" className="main" tabIndex={-1}>
        {section?.key === 'config' && current !== 'settings' && (
          <Link to="/configuracion" className="back-link"><ChevronLeft size={18} aria-hidden /> Configuración</Link>
        )}
        <Suspense fallback={<p className="muted" aria-busy="true">Cargando…</p>}>
          <Outlet />
        </Suspense>
      </main>

      <nav className="bottom-nav" aria-label="Navegación inferior">
        {bottom.map((k) => {
          const Icon = MODULE_ICON[k];
          return (
            <NavLink key={k} to={MODULE_PATH[k]} end={k === 'dashboard'}>
              <Icon size={23} aria-hidden />
              <span>{navLabel(settings, k)}</span>
            </NavLink>
          );
        })}
        {salonBottom.map((i) => {
          const Icon = i.icon;
          return (
            <Link key={i.key} to={i.to} className={salonActive === i.key ? 'active' : undefined} aria-current={salonActive === i.key ? 'page' : undefined}>
              <Icon size={23} aria-hidden />
              <span>{i.label}</span>
            </Link>
          );
        })}
        <NavLink to="/mas">
          <LayoutGrid size={23} aria-hidden />
          <span>Más</span>
        </NavLink>
      </nav>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

/** Barra inferior del Salón: Mesas, Mostrador, Cocina y Caja (o lo que la persona pueda ver). */
function pickSalonBottom(items: SalonItem[]): SalonItem[] {
  const prefer = ['inicio', 'mesas', 'mostrador', 'cocina', 'caja', 'comprobantes', 'carta'];
  return prefer.map((k) => items.find((i) => i.key === k)).filter((i): i is SalonItem => !!i).slice(0, 4);
}

/** Selector de área: Stock o Salón. */
export function AreaSwitch({ area, onChange, className = '' }: { area: Area; onChange: (a: Area) => void; className?: string }) {
  return (
    <div className={`area-switch ${className}`} role="group" aria-label="Área">
      {(['salon', 'stock'] as Area[]).map((a) => {
        const Icon = AREA_ICON[a];
        return (
          <button key={a} type="button" className="area-switch-btn" aria-label={AREA_LABEL[a]} aria-pressed={area === a} onClick={() => onChange(a)}>
            <Icon size={16} aria-hidden />
            <span>{AREA_LABEL[a]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Accesos de la barra de arriba: lo de todos los días del Salón, uno por uno; el resto, por grupo. */
const QUICK = ['s-mesas', 's-mostrador', 's-cocina', 's-caja'];
const GROUP_ICON: Record<MenuGroup, LucideIcon> = { ventas: Boxes, productos: Package, stock: Boxes, compras: Receipt, reportes: LineChart, admin: SettingsIcon };
const GROUP_SHORT: Partial<Record<MenuGroup, string>> = { compras: 'Compras', admin: 'Configuración' };

interface TopItem { key: string; label: string; icon: LucideIcon; to: string; area: Area; keys: string[] }

/** Lo que va en la barra de arriba (computadora), como en Fudo. */
function topItems(groups: MenuGroupEntries[]): TopItem[] {
  const all = groups.flatMap((g) => g.entries);
  const byKey = new Map(all.map((e) => [e.key, e]));
  const out: TopItem[] = [];
  const ventas = groups.find((g) => g.key === 'ventas');
  for (const k of QUICK) {
    const e = byKey.get(k);
    if (!e) continue;
    // "Salón" (las mesas) también queda marcado en el resto de Ventas (Cta. corriente, Comprobantes…).
    const keys = k === 's-mesas' ? (ventas?.entries.map((x) => x.key).filter((x) => !QUICK.includes(x) || x === 's-mesas') ?? [k]) : [k];
    out.push({ key: k, label: k === 's-mesas' ? 'Salón' : e.label, icon: e.icon, to: e.to, area: e.area, keys });
  }
  if (ventas && !byKey.has('s-mesas')) {
    const rest = ventas.entries.filter((e) => !QUICK.includes(e.key));
    if (rest.length) out.push({ key: 'g-ventas', label: 'Ventas', icon: rest[0].icon, to: rest[0].to, area: rest[0].area, keys: rest.map((e) => e.key) });
  }
  for (const g of groups) {
    if (g.key === 'ventas') continue;
    const first = g.entries[0];
    out.push({ key: `g-${g.key}`, label: GROUP_SHORT[g.key] ?? g.label, icon: GROUP_ICON[g.key], to: first.to, area: first.area, keys: g.entries.map((e) => e.key) });
  }
  return out;
}

/** Barra de arriba (computadora): Salón, Mostrador, Cocina, Caja y los grupos. */
function MainNav({ groups, active }: { groups: MenuGroupEntries[]; active?: string }) {
  const items = topItems(groups);
  if (!items.length) return null;
  return (
    <nav className="main-nav" aria-label="Menú principal">
      {items.map((i) => {
        const on = !!active && i.keys.includes(active);
        return (
          <Link key={i.key} to={i.to} className={`main-nav-item ${on ? 'active' : ''} ${i.key === 'g-admin' ? 'is-icon' : ''}`} aria-current={on ? 'page' : undefined} title={i.key === 'g-admin' ? i.label : undefined} onClick={() => writeArea(i.area)}>
            <i.icon size={18} aria-hidden />
            <span>{i.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Debajo de la barra (computadora): todas las pantallas del grupo en el que estás. */
function SubNav({ groups, active }: { groups: MenuGroupEntries[]; active?: string }) {
  const group = active ? groups.find((g) => g.entries.some((e) => e.key === active)) : undefined;
  if (!group || group.entries.length < 2) return null;
  return (
    <nav className="sub-nav" aria-label={`Menú: ${group.label}`}>
      {group.entries.map((e: MenuEntry) => (
        <Link key={e.key} to={e.to} className={`sub-nav-item ${e.key === active ? 'active' : ''}`} aria-current={e.key === active ? 'page' : undefined} onClick={() => writeArea(e.area)}>
          {e.label}
        </Link>
      ))}
    </nav>
  );
}

/** Pestañas con los módulos de la sección actual (p. ej. Productos · Familias · Unidades · Ubicaciones). */
function SectionTabs({ tabs, label }: { tabs: ModuleKey[]; label: string }) {
  const settings = useSettings();
  return (
    <nav className="section-tabs" aria-label={`Pestañas de ${label}`}>
      {tabs.map((k) => (
        <NavLink key={k} to={MODULE_PATH[k]} end={k === 'dashboard'} className="section-tab">
          {navLabel(settings, k)}
        </NavLink>
      ))}
    </nav>
  );
}

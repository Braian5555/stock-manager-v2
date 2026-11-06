import { ChevronLeft, ChevronRight, CloudOff, HelpCircle, LayoutGrid, Search, Sparkles, UploadCloud } from 'lucide-react';
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
  AREA_ICON, AREA_LABEL, MODULE_ICON, MODULE_PATH, SALON_MODULES, activeSalonItem, areaHome, areaOfModule, areasFor, bottomNavModules, moduleOfPath, navLabel, readArea, salonItems,
  soleModule, visibleModules, visibleSections, writeArea, type Area, type SalonItem, type VisibleSection,
} from './modules';
import { useAutoSync } from '../hooks/useAutoSync';
import { SyncBadge } from '../components/SyncBadge';
import { UserMenu } from '../components/auth/UserMenu';
import { useSession } from '../store/session';
import { useAssistantAvailable } from '../store/assistant';
import type { ModuleKey } from '../models';

/**
 * Estructura de la app:
 * - Computadora (≥ 1024 px): barra lateral con las secciones (se puede achicar), encabezado
 *   claro con buscador, sincronización y usuario, y pestañas con los módulos de la sección.
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
  const [collapsed, setCollapsed] = useState(() => readCollapsed());
  const toggleSidebar = () => setCollapsed((c) => { writeCollapsed(!c); return !c; });
  const connected = integration && integration.mode !== 'disabled' && integration.mode !== 'excel' && integration.status !== 'desconectado';
  // En el Inicio los accesos ya están en la pantalla: sin barra lateral (en las demás, sí).
  const isHome = location.pathname === '/';
  const assistant = useAssistantAvailable();

  return (
    <div className={`app ${collapsed ? 'side-collapsed' : ''} ${isHome ? 'no-side' : ''}`}>
      <a href="#contenido" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('contenido')?.focus(); }}>Saltar al contenido</a>
      <header className="topbar">
        <Link to={home} className="brand" aria-label={`${settings.businessName} — ${area === 'salon' ? 'Salón' : 'Inicio'}`}>
          <Logo size={34} />
          <span className="brand-text">
            <span className="brand-name truncate">{settings.businessName}</span>
            {settings.subtitle && <span className="brand-sub truncate">{settings.subtitle}</span>}
          </span>
        </Link>

        {section && <span className="topbar-title truncate">{section.label}</span>}
        {salonCurrent && <span className="topbar-title truncate">{salonCurrent.label}</span>}
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

      {!isHome && <Sidebar sections={sections} salon={salon} area={area} areas={areas} onArea={switchArea} home={home} assistant={assistant} active={area === 'salon' ? salonActive : section?.key ?? (/^\/(ayuda|acerca)/.test(location.pathname) ? 'ayuda' : location.pathname.startsWith('/asistente') ? 'asistente' : undefined)} collapsed={collapsed} onToggle={toggleSidebar} />}
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

const SIDE_KEY = 'sm:sidebar-collapsed';
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(SIDE_KEY, v ? '1' : '0');
  } catch {
    /* sin almacenamiento: queda sólo en esta sesión */
  }
}

/** Barra inferior del Salón: Mesas, Mostrador, Cocina y Caja (o lo que la persona pueda ver). */
function pickSalonBottom(items: SalonItem[]): SalonItem[] {
  const prefer = ['mesas', 'mostrador', 'cocina', 'caja', 'comprobantes', 'carta'];
  return prefer.map((k) => items.find((i) => i.key === k)).filter((i): i is SalonItem => !!i).slice(0, 4);
}

/** Selector de área: Stock o Salón. */
export function AreaSwitch({ area, onChange, className = '' }: { area: Area; onChange: (a: Area) => void; className?: string }) {
  return (
    <div className={`area-switch ${className}`} role="group" aria-label="Área">
      {(['stock', 'salon'] as Area[]).map((a) => {
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

/** Barra lateral (computadora): selector de área y una entrada por sección; abajo, Configuración y Ayuda. */
function Sidebar({ sections, salon, area, areas, onArea, home, active, collapsed, onToggle, assistant }: {
  sections: VisibleSection[]; salon: SalonItem[]; area: Area; areas: Area[]; onArea: (a: Area) => void; home: string; active?: string; collapsed: boolean; onToggle: () => void; assistant: boolean;
}) {
  const settings = useSettings();
  const salonItem = (i: SalonItem) => {
    const Icon = i.icon;
    return (
      <Link key={i.key} to={i.to} className={`side-item ${active === i.key ? 'active' : ''}`} aria-current={active === i.key ? 'page' : undefined} title={collapsed ? i.label : undefined}>
        <Icon size={20} aria-hidden />
        <span className="side-label">{i.label}</span>
      </Link>
    );
  };
  const item = (sec: VisibleSection) => {
    const Icon = sec.icon;
    return (
      <Link key={sec.key} to={MODULE_PATH[sec.tabs[0]]} className={`side-item ${active === sec.key ? 'active' : ''}`} aria-current={active === sec.key ? 'page' : undefined} title={collapsed ? sec.label : undefined}>
        <Icon size={20} aria-hidden />
        <span className="side-label">{sec.label}</span>
      </Link>
    );
  };
  return (
    <aside className="sidebar">
      <div className="side-head">
        <Link to={home} className="side-brand" aria-label={`${settings.businessName} — ${area === 'salon' ? 'Salón' : 'Inicio'}`}>
          <Logo size={32} />
          <span className="side-label side-brand-name truncate">{settings.businessName}</span>
        </Link>
        <button type="button" className="side-toggle" onClick={onToggle} aria-label={collapsed ? 'Agrandar menú' : 'Achicar menú'} aria-expanded={!collapsed}>
          {collapsed ? <ChevronRight size={18} aria-hidden /> : <ChevronLeft size={18} aria-hidden />}
        </button>
      </div>
      {areas.length > 1 && (collapsed
        ? <button type="button" className="side-item side-area" onClick={() => onArea(area === 'stock' ? 'salon' : 'stock')} title={`Ir a ${AREA_LABEL[area === 'stock' ? 'salon' : 'stock']}`} aria-label={`Ir a ${AREA_LABEL[area === 'stock' ? 'salon' : 'stock']}`}>{area === 'stock' ? <AREA_ICON.salon size={20} aria-hidden /> : <AREA_ICON.stock size={20} aria-hidden />}</button>
        : <AreaSwitch area={area} onChange={onArea} className="area-switch-side" />)}
      <nav className="side-nav" aria-label={area === 'salon' ? 'Navegación: Salón' : 'Navegación principal'}>
        {sections.filter((s) => !s.bottom).map(item)}
        {salon.filter((i) => !i.bottom).map(salonItem)}
        {assistant && (
          <Link to="/asistente" className={`side-item ${active === 'asistente' ? 'active' : ''}`} aria-current={active === 'asistente' ? 'page' : undefined} title={collapsed ? 'Asistente IA' : undefined}>
            <Sparkles size={20} aria-hidden />
            <span className="side-label">Asistente IA</span>
          </Link>
        )}
        <span className="grow" />
        {sections.filter((s) => s.bottom).map(item)}
        {salon.filter((i) => i.bottom).map(salonItem)}
        <Link to="/ayuda" className={`side-item ${active === 'ayuda' ? 'active' : ''}`} title={collapsed ? 'Ayuda' : undefined}>
          <HelpCircle size={20} aria-hidden />
          <span className="side-label">Ayuda</span>
        </Link>
      </nav>
    </aside>
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

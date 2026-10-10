import { ChevronLeft, ChevronRight, CloudOff, HelpCircle, LayoutGrid, Search, UploadCloud } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { GlobalSearch } from '../components/GlobalSearch';
import { Logo } from '../components/Logo';
import { useIntegration, useOnline, usePendingJobs } from '../hooks/useData';
import { syncPending } from '../integrations/integrationService';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { MODULE_ICON, MODULE_PATH, bottomNavModules, moduleOfPath, navLabel, visibleModules, visibleSections, type VisibleSection } from './modules';
import { useAutoSync } from '../hooks/useAutoSync';
import { SyncBadge } from '../components/SyncBadge';
import { QuickAdd } from '../components/QuickAdd';
import { UserMenu } from '../components/auth/UserMenu';
import { useSession } from '../store/session';
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
  const single = visible.filter((k) => k !== 'settings').length === 1 ? visible.find((k) => k !== 'settings') : undefined;
  useEffect(() => {
    if (single && location.pathname !== MODULE_PATH[single]) navigate(MODULE_PATH[single], { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar de usuario
  }, [user?.id, single]);
  const sections = visibleSections(settings, visible);
  const current = moduleOfPath(location.pathname);
  const section = sections.find((sec) => current && sec.tabs.includes(current));
  const bottom = bottomNavModules(settings, visible);
  const [collapsed, setCollapsed] = useState(() => readCollapsed());
  const toggleSidebar = () => setCollapsed((c) => { writeCollapsed(!c); return !c; });
  const connected = integration && integration.mode !== 'disabled' && integration.mode !== 'excel' && integration.status !== 'desconectado';

  return (
    <div className={`app ${collapsed ? 'side-collapsed' : ''}`}>
      <a href="#contenido" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('contenido')?.focus(); }}>Saltar al contenido</a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label={`${settings.businessName} — Inicio`}>
          <Logo size={34} />
          <span className="brand-text">
            <span className="brand-name truncate">{settings.businessName}</span>
            {settings.subtitle && <span className="brand-sub truncate">{settings.subtitle}</span>}
          </span>
        </Link>

        {section && <span className="topbar-title truncate">{section.label}</span>}
        <span className="grow topbar-spacer" />
        {can('stock.view') && (
          <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Buscar (Ctrl+K)">
            <Search size={18} aria-hidden />
            <span className="search-trigger-text">Buscar…</span>
            <kbd className="search-trigger-kbd">Ctrl K</kbd>
          </button>
        )}
        <SyncBadge compact />
        <UserMenu />
      </header>

      <Sidebar sections={sections} active={section?.key ?? (/^\/(ayuda|acerca)/.test(location.pathname) ? 'ayuda' : undefined)} collapsed={collapsed} onToggle={toggleSidebar} />
      {section && section.tabs.length > 1 && <SectionTabs tabs={section.tabs} label={section.label} />}

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
        <NavLink to="/mas">
          <LayoutGrid size={23} aria-hidden />
          <span>Más</span>
        </NavLink>
      </nav>
      <QuickAdd />
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

/** Barra lateral (computadora): una entrada por sección; abajo, Configuración y Ayuda. */
function Sidebar({ sections, active, collapsed, onToggle }: { sections: VisibleSection[]; active?: string; collapsed: boolean; onToggle: () => void }) {
  const settings = useSettings();
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
        <Link to="/" className="side-brand" aria-label={`${settings.businessName} — Inicio`}>
          <Logo size={32} />
          <span className="side-label side-brand-name truncate">{settings.businessName}</span>
        </Link>
        <button type="button" className="side-toggle" onClick={onToggle} aria-label={collapsed ? 'Agrandar menú' : 'Achicar menú'} aria-expanded={!collapsed}>
          {collapsed ? <ChevronRight size={18} aria-hidden /> : <ChevronLeft size={18} aria-hidden />}
        </button>
      </div>
      <nav className="side-nav" aria-label="Navegación principal">
        {sections.filter((s) => !s.bottom).map(item)}
        <span className="grow" />
        {sections.filter((s) => s.bottom).map(item)}
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

import { ChevronDown, CloudOff, LayoutGrid, Search, Settings as SettingsIcon, UploadCloud } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { GlobalSearch } from '../components/GlobalSearch';
import { Logo } from '../components/Logo';
import { useIntegration, useOnline, usePendingJobs } from '../hooks/useData';
import { syncPending } from '../integrations/integrationService';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { MODULE_GROUPS, MODULE_ICON, MODULE_PATH, bottomNavModules, navLabel, topNavModules, visibleModules } from './modules';
import { useAutoSync } from '../hooks/useAutoSync';
import { SyncBadge } from '../components/SyncBadge';
import { QuickAdd } from '../components/QuickAdd';
import { UserMenu } from '../components/auth/UserMenu';
import { useSession } from '../store/session';
import type { ModuleKey } from '../models';

/**
 * Estructura de la app:
 * - Computadora (≥ 1024 px): barra superior con los módulos principales, "Más", buscador,
 *   estado de sincronización, configuración y usuario.
 * - Celular/tablet: encabezado compacto + barra inferior fija (4 módulos + "Más").
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
  const { top, more } = topNavModules(settings, visible);
  const bottom = bottomNavModules(settings, visible);
  const connected = integration && integration.mode !== 'disabled' && integration.mode !== 'excel' && integration.status !== 'desconectado';
  const moreActive = more.some((k) => k !== 'dashboard' && location.pathname.startsWith(MODULE_PATH[k]));

  return (
    <div className="app">
      <a href="#contenido" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('contenido')?.focus(); }}>Saltar al contenido</a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label={`${settings.businessName} — Inicio`}>
          <Logo size={34} />
          <span className="brand-text">
            <span className="brand-name truncate">{settings.businessName}</span>
            {settings.subtitle && <span className="brand-sub truncate">{settings.subtitle}</span>}
          </span>
        </Link>

        <nav className="topnav" aria-label="Navegación principal">
          {top.map((k) => <TopLink key={k} k={k} label={navLabel(settings, k)} />)}
          {more.length > 0 && <MoreMenu keys={more} active={moreActive} />}
        </nav>

        <span className="grow topbar-spacer" />
        {can('stock.view') && (
          <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Buscar (Ctrl+K)">
            <Search size={18} aria-hidden />
            <span className="search-trigger-text">Buscar…</span>
            <kbd className="search-trigger-kbd">Ctrl K</kbd>
          </button>
        )}
        <SyncBadge compact />
        {can('admin') && (
          <NavLink to="/configuracion" className="btn btn-ghost icon-btn topbar-settings" aria-label="Configuración" title="Configuración">
            <SettingsIcon size={20} aria-hidden />
          </NavLink>
        )}
        <UserMenu />
      </header>

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

function TopLink({ k, label }: { k: ModuleKey; label: string }) {
  const Icon = MODULE_ICON[k];
  return (
    <NavLink to={MODULE_PATH[k]} end={k === 'dashboard'} className="topnav-item" title={label}>
      <Icon size={19} aria-hidden />
      <span className="topnav-label">{label}</span>
    </NavLink>
  );
}

/** "Más" de la barra superior: el resto de los módulos, agrupados. */
function MoreMenu({ keys, active }: { keys: ModuleKey[]; active: boolean }) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  // Al cambiar de página (atrás/adelante, un link, el buscador) el panel se cierra.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const set = new Set(keys);
  const groups = MODULE_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => set.has(k)) })).filter((g) => g.keys.length);
  return (
    <div ref={ref} className="topnav-more">
      <button type="button" className={`topnav-item ${active ? 'active' : ''}`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <LayoutGrid size={19} aria-hidden />
        <span className="topnav-label">Más <ChevronDown size={13} aria-hidden /></span>
      </button>
      {open && (
        <div className="more-panel card" role="region" aria-label="Más secciones">
          {groups.map((g) => (
            <div key={g.title} className="more-group">
              <div className="more-group-title">{g.title}</div>
              {g.keys.map((k) => {
                const Icon = MODULE_ICON[k];
                return (
                  <NavLink key={k} to={MODULE_PATH[k]} className="more-link" onClick={() => setOpen(false)}>
                    <Icon size={18} aria-hidden /> {navLabel(settings, k)}
                  </NavLink>
                );
              })}
            </div>
          ))}
          <div className="more-group">
            <div className="more-group-title">Ayuda</div>
            <NavLink to="/ayuda" className="more-link" onClick={() => setOpen(false)}>Ayuda y guía rápida</NavLink>
            <NavLink to="/acerca" className="more-link" onClick={() => setOpen(false)}>Información de la aplicación</NavLink>
          </div>
        </div>
      )}
    </div>
  );
}

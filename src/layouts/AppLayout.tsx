import { CloudOff, Menu as MenuIcon, Search, UploadCloud } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { GlobalSearch } from '../components/GlobalSearch';
import { Logo } from '../components/Logo';
import { useIntegration, useOnline, usePendingJobs } from '../hooks/useData';
import { syncPending } from '../integrations/integrationService';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { BOTTOM_KEYS, MODULE_ICON, MODULE_PATH } from './modules';
import { useAutoSync } from '../hooks/useAutoSync';
import { SyncBadge } from '../components/SyncBadge';

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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Llaves obligatorias: en Chrome reciente scrollTo() devuelve una Promise y React
  // la trataría como función de limpieza ("l is not a function" al navegar).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const visible = settings.menu.filter((m) => m.visible);
  const bottom = visible.filter((m) => BOTTOM_KEYS.includes(m.key));
  const connected = integration && integration.mode !== 'disabled' && integration.mode !== 'excel' && integration.status !== 'desconectado';

  const brand = (
    <Link to="/" className="brand" aria-label={`${settings.businessName} — Inicio`}>
      <Logo />
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="brand-name truncate" style={{ display: 'block' }}>{settings.businessName}</span>
        {settings.subtitle && <span className="brand-sub truncate" style={{ display: 'block' }}>{settings.subtitle}</span>}
      </span>
    </Link>
  );

  return (
    <div className="app">
      <a href="#contenido" className="skip-link">Saltar al contenido</a>
      <aside className="sidebar" aria-label="Menú principal">
        {brand}
        <nav>
          {visible.map((m) => {
            const Icon = MODULE_ICON[m.key];
            return (
              <NavLink key={m.key} to={MODULE_PATH[m.key]} end={m.key === 'dashboard'}>
                <Icon size={19} aria-hidden />
                {m.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <div style={{ minWidth: 0 }}>
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
        <header className="topbar">
          {brand}
          <span className="grow" />
          <SyncBadge compact />
          <button type="button" className="btn btn-ghost" onClick={() => setSearchOpen(true)} aria-label="Buscar (Ctrl+K)">
            <Search size={20} aria-hidden />
            <span className="small muted" style={{ display: 'none' }}>Buscar</span>
          </button>
        </header>
        <main id="contenido" className="main" tabIndex={-1}>
          <Suspense fallback={<p className="muted" aria-busy="true">Cargando…</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegación inferior">
        {bottom.map((m) => {
          const Icon = MODULE_ICON[m.key];
          return (
            <NavLink key={m.key} to={MODULE_PATH[m.key]} end={m.key === 'dashboard'}>
              <Icon size={22} aria-hidden />
              <span>{m.label}</span>
            </NavLink>
          );
        })}
        <NavLink to="/mas">
          <MenuIcon size={22} aria-hidden />
          <span>Más</span>
        </NavLink>
      </nav>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

import { ChevronRight, HelpCircle, Info, Lock, LogOut } from 'lucide-react';
import { Link } from 'react-router';
import { MODULE_GROUPS, MODULE_ICON, MODULE_PATH, bottomNavModules, navLabel, visibleModules } from '../layouts/modules';
import { ROLE_LABEL } from '../services/userService';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { PageHeader } from '../components/ui';
import { UserAvatar } from '../components/auth/UserAvatar';
import { SyncBadge } from '../components/SyncBadge';

/** "Más" del celular: lo que no está en la barra inferior, agrupado por tema. */
export function MorePage() {
  const settings = useSettings();
  const { canAny, lock, cloudMode, user } = useSession();
  const visible = visibleModules(settings, canAny);
  const inBar = new Set(bottomNavModules(settings, visible));
  const allowed = new Set(visible.filter((k) => !inBar.has(k)));
  const groups = MODULE_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => allowed.has(k)) })).filter((g) => g.keys.length);

  return (
    <>
      <PageHeader title="Más" />
      {user && (
        <section className="card card-pad row more-user">
          <UserAvatar user={user} size={46} />
          <div className="grow">
            <div className="list-title truncate">{user.name}</div>
            <div className="list-sub">{ROLE_LABEL[user.role]}{user.email ? ` · ${user.email}` : ''}</div>
          </div>
          <SyncBadge compact />
        </section>
      )}

      {groups.map((g) => (
        <section key={g.title} className="more-section" aria-label={g.title}>
          <h2 className="more-section-title">{g.title}</h2>
          <nav className="card list">
            {g.keys.map((k) => {
              const Icon = MODULE_ICON[k];
              return (
                <Link key={k} to={MODULE_PATH[k]} className="list-item more-row">
                  <span className="stat-icon" aria-hidden><Icon size={19} /></span>
                  <span className="grow list-title">{navLabel(settings, k)}</span>
                  <ChevronRight size={18} className="muted" aria-hidden />
                </Link>
              );
            })}
          </nav>
        </section>
      ))}

      <section className="more-section" aria-label="Ayuda">
        <h2 className="more-section-title">Ayuda</h2>
        <nav className="card list">
          <Link to="/ayuda" className="list-item more-row">
            <span className="stat-icon" aria-hidden><HelpCircle size={19} /></span>
            <span className="grow list-title">Ayuda y guía rápida</span>
            <ChevronRight size={18} className="muted" aria-hidden />
          </Link>
          <Link to="/acerca" className="list-item more-row">
            <span className="stat-icon" aria-hidden><Info size={19} /></span>
            <span className="grow list-title">Información de la aplicación</span>
            <ChevronRight size={18} className="muted" aria-hidden />
          </Link>
        </nav>
      </section>

      <button type="button" className="btn btn-block more-logout" onClick={() => void lock()}>
        {cloudMode ? <><LogOut size={18} aria-hidden /> Cerrar sesión</> : <><Lock size={18} aria-hidden /> Bloquear / cambiar usuario</>}
      </button>
      <p className="small muted" style={{ marginTop: 16, textAlign: 'center' }}>Stock Manager v{__APP_VERSION__}</p>
    </>
  );
}

import { ChevronRight, HelpCircle, Info, Lock, LogOut, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import {
  MODULE_GROUPS, MODULE_ICON, MODULE_PATH, SALON_MODULES, areaHome, areasFor, bottomNavModules, navLabel, readArea, salonItems, visibleModules, writeArea, type Area,
} from '../layouts/modules';
import { AreaSwitch } from '../layouts/AppLayout';
import { ROLE_LABEL } from '../services/userService';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { PageHeader } from '../components/ui';
import { UserAvatar } from '../components/auth/UserAvatar';
import { SyncBadge } from '../components/SyncBadge';
import { useAssistantAvailable } from '../store/assistant';
import { AccessibilitySection } from '../components/AccessibilitySection';

/** "Más" del celular: el selector de área y lo que no está en la barra inferior, agrupado por tema. */
export function MorePage() {
  const settings = useSettings();
  const navigate = useNavigate();
  const { canAny, lock, cloudMode, user } = useSession();
  const visible = visibleModules(settings, canAny);
  const areas = areasFor(visible);
  const saved = readArea();
  const area: Area = saved && areas.includes(saved) ? saved : areas[0] ?? 'stock';
  const stockVisible = visible.filter((k) => !SALON_MODULES.has(k));
  const inBar = new Set(bottomNavModules(settings, stockVisible));
  const allowed = new Set(stockVisible.filter((k) => !inBar.has(k)));
  const assistant = useAssistantAvailable();
  const groups = area === 'stock' ? MODULE_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => allowed.has(k)) })).filter((g) => g.keys.length) : [];
  const salon = area === 'salon' ? salonItems(visible, canAny) : [];
  const switchArea = (a: Area) => { writeArea(a); navigate(areaHome(a, visible, canAny)); };

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

      {areas.length > 1 && (
        <section className="more-section" aria-label="Área">
          <h2 className="more-section-title">Área</h2>
          <AreaSwitch area={area} onChange={switchArea} className="area-switch-more" />
        </section>
      )}

      {salon.length > 0 && (
        <section className="more-section" aria-label="Salón">
          <h2 className="more-section-title">Salón</h2>
          <nav className="more-tiles" aria-label="Salón">
            {salon.map((i) => {
              const Icon = i.icon;
              return (
                <Link key={i.key} to={i.to} className="more-tile">
                  <Icon size={24} aria-hidden />
                  <span>{i.label}</span>
                </Link>
              );
            })}
          </nav>
        </section>
      )}

      {assistant && (
        <Link to="/asistente" className="more-ai">
          <span className="more-ai-icon" aria-hidden><Sparkles size={24} /></span>
          <span className="grow">
            <span className="more-ai-title">Asistente IA</span>
            <span className="more-ai-sub">Preguntale o pedile cosas a la app</span>
          </span>
          <ChevronRight size={20} aria-hidden />
        </Link>
      )}

      {groups.map((g) => (
        <section key={g.title} className="more-section" aria-label={g.title}>
          <h2 className="more-section-title">{g.title}</h2>
          <nav className="more-tiles" aria-label={g.title}>
            {g.keys.map((k) => {
              const Icon = MODULE_ICON[k];
              return (
                <Link key={k} to={MODULE_PATH[k]} className="more-tile">
                  <Icon size={24} aria-hidden />
                  <span>{navLabel(settings, k)}</span>
                </Link>
              );
            })}
          </nav>
        </section>
      ))}

      <section className="more-section" aria-label="Letra y contraste">
        <h2 className="more-section-title">Letra y contraste</h2>
        <div className="card card-pad"><AccessibilitySection compact /></div>
      </section>

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

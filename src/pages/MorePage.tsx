import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { BOTTOM_KEYS, MODULE_ICON, MODULE_PATH, MODULE_PERMISSIONS } from '../layouts/modules';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { PageHeader } from '../components/ui';

export function MorePage() {
  const settings = useSettings();
  const { canAny, lock } = useSession();
  const items = settings.menu.filter((m) => m.visible && !BOTTOM_KEYS.includes(m.key) && canAny(MODULE_PERMISSIONS[m.key]));
  return (
    <>
      <PageHeader title="Más" />
      <nav className="card list" aria-label="Más secciones">
        {items.map((m) => {
          const Icon = MODULE_ICON[m.key];
          return (
            <Link key={m.key} to={MODULE_PATH[m.key]} className="list-item">
              <span className="stat-icon" aria-hidden><Icon size={18} /></span>
              <span className="grow list-title">{m.label}</span>
              <ChevronRight size={18} className="muted" aria-hidden />
            </Link>
          );
        })}
      </nav>
      <button type="button" className="btn btn-block" style={{ marginTop: 16 }} onClick={() => void lock()}>Bloquear / cambiar usuario</button>
      <p className="small muted" style={{ marginTop: 16, textAlign: 'center' }}>Stock Manager v{__APP_VERSION__}</p>
    </>
  );
}

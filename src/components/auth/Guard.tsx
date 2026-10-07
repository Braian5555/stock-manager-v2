import { ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ModuleKey } from '../../models';
import { MODULE_PATH, MODULE_PERMISSIONS } from '../../layouts/modules';
import { useSession } from '../../store/session';
import { useSettings } from '../../store/settings';
import { EmptyState } from '../ui';

/** Primer módulo visible que el usuario puede usar (para redirigir o volver). */
export function useFirstAllowedPath(): string {
  const { canAny } = useSession();
  const settings = useSettings();
  const m = settings.menu.find((x) => x.visible && canAny(MODULE_PERMISSIONS[x.key]));
  return m ? MODULE_PATH[m.key] : '/';
}

/** Protege una pantalla según los permisos del usuario actual. */
export function Guard({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { canAny } = useSession();
  const first = useFirstAllowedPath();
  if (canAny(MODULE_PERMISSIONS[module])) return <>{children}</>;
  return (
    <EmptyState icon={<ShieldOff size={40} />} title="No tenés permiso para esta sección" action={first !== MODULE_PATH[module] ? <Link to={first} className="btn btn-primary">Ir a mi inicio</Link> : undefined}>
      Pedile a un administrador que te habilite el acceso desde Usuarios.
    </EmptyState>
  );
}

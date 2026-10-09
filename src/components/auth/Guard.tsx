import { ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
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
  const settings = useSettings();
  const first = useFirstAllowedPath();
  if (canAny(MODULE_PERMISSIONS[module])) return <>{children}</>;
  // Inicio sin permiso de stock (p. ej. un usuario que sólo hace remitos): ir a su primera sección.
  if (module === 'dashboard' && first !== MODULE_PATH.dashboard) return <Navigate to={first} replace />;
  // Quien usa una sola sección (p. ej. el panadero, sólo Producción) siempre cae ahí.
  const allowed = settings.menu.filter((x) => x.visible && x.key !== 'settings' && canAny(MODULE_PERMISSIONS[x.key]));
  if (allowed.length === 1 && first !== MODULE_PATH[module]) return <Navigate to={first} replace />;
  return (
    <EmptyState icon={<ShieldOff size={40} />} title="No tenés permiso para esta sección" action={first !== MODULE_PATH[module] ? <Link to={first} className="btn btn-primary">Ir a mi inicio</Link> : undefined}>
      Pedile a un administrador que te habilite el acceso desde Usuarios.
    </EmptyState>
  );
}

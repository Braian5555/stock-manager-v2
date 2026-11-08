import { Store } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ID, Outlet } from '../../models';
import { setDeviceLocal, useLocalScope } from '../../services/localScope';
import { useSession } from '../../store/session';

/** Locales en los que puede trabajar esta persona (administrador, o sin locales asignados: todos). */
export function allowedLocals(outlets: Outlet[], userOutletIds: ID[] | undefined, admin: boolean): Outlet[] {
  if (admin || !userOutletIds?.length) return outlets;
  return outlets.filter((o) => userOutletIds.includes(o.id));
}

/**
 * Con locales cargados, el Salón sólo se usa en el local del equipo. Si el equipo todavía no tiene
 * local (o la persona no trabaja en ese local), primero se elige: así nada se cruza entre locales.
 */
export function LocalGate({ children }: { children: ReactNode }) {
  const scope = useLocalScope();
  const { user, can } = useSession();
  const admin = can('admin');
  const mine = allowedLocals(scope.outlets, user?.outletIds, admin);
  const ok = !scope.outlets.length || (!!scope.current && mine.some((o) => o.id === scope.current!.id));
  // Si trabaja en un solo local y el equipo no tiene ninguno, se elige solo.
  const only = !ok && !scope.current && mine.length === 1 ? mine[0].id : undefined;
  useEffect(() => { if (only) setDeviceLocal(only); }, [only]);
  if (ok) return <>{children}</>;
  return (
    <section className="card card-pad stack local-pick" aria-labelledby="local-pick-title" style={{ maxWidth: 560, margin: '24px auto' }}>
      <h1 id="local-pick-title" className="row" style={{ gap: 10, margin: 0, fontSize: '1.4rem' }}><Store size={24} aria-hidden /> ¿En qué local trabaja este equipo?</h1>
      {scope.current && <p style={{ margin: 0 }}>Este equipo está en <b>{scope.current.name}</b>, y vos no trabajás en ese local.</p>}
      <p className="muted" style={{ margin: 0 }}>Cada local tiene sus mesas, su carta, sus ventas, su caja y sus facturas. Elegí el de esta compu (después se cambia en Configuración → Locales).</p>
      {mine.length === 0 ? (
        <p style={{ margin: 0 }}>No tenés locales asignados. Pedile al administrador que te asigne uno en Usuarios.</p>
      ) : (
        <div className="local-pick-list">
          {mine.map((o) => (
            <button key={o.id} type="button" className="btn local-pick-btn" onClick={() => setDeviceLocal(o.id)}>
              <span className="local-pick-code">{o.code ?? '·'}</span>
              <span>{o.name}</span>
              {o.ptoVta ? <span className="small muted">PV {o.ptoVta}</span> : null}
            </button>
          ))}
        </div>
      )}
      {admin && <p className="small muted" style={{ margin: 0 }}>Los locales se cargan en <Link to="/configuracion/locales">Configuración → Locales</Link>.</p>}
    </section>
  );
}

/** Chip con el local del equipo (en el encabezado). */
export function LocalChip() {
  const scope = useLocalScope();
  if (!scope.current) return null;
  return (
    <Link to="/configuracion/locales" className="local-chip" title="Local de este equipo" aria-label={`Local de este equipo: ${scope.current.name}`}>
      <Store size={16} aria-hidden />
      <span className="truncate">{scope.current.name}</span>
    </Link>
  );
}

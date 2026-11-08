import { Building, Store } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { ID, Outlet } from '../../models';
import { CENTRAL, setCentralView, setDeviceLocal, useLocalScope } from '../../services/localScope';
import { useSession } from '../../store/session';

/** Locales en los que puede trabajar esta persona (administrador, o sin locales asignados: todos). */
export function allowedLocals(outlets: Outlet[], userOutletIds: ID[] | undefined, admin: boolean): Outlet[] {
  if (admin || !userOutletIds?.length) return outlets;
  return outlets.filter((o) => userOutletIds.includes(o.id));
}

/** Pantallas para operar (cargar pedidos, cobrar, caja): necesitan un local, también en la Central. */
export function isOperational(pathname: string, search: string): boolean {
  if (pathname === '/cocina') return true;
  if (pathname !== '/salon') return false;
  return !/[?&]vista=(hoy|reportes|cuentas)\b/.test(search);
}

/**
 * Con locales cargados, el Salón sólo se usa en el local del equipo. Si el equipo todavía no tiene
 * local (o la persona no trabaja en ese local), primero se elige: así nada se cruza entre locales.
 * La Central (administradores) ve todos los locales juntos; para operar elige uno.
 */
export function LocalGate({ children }: { children: ReactNode }) {
  const scope = useLocalScope();
  const { user, can } = useSession();
  const location = useLocation();
  const admin = can('admin');
  const mine = allowedLocals(scope.outlets, user?.outletIds, admin);
  const centralOk = scope.central && admin;
  const ok = !scope.outlets.length
    || (centralOk && (!!scope.current || !isOperational(location.pathname, location.search)))
    || (!scope.central && !!scope.current && mine.some((o) => o.id === scope.current!.id));
  // Si trabaja en un solo local y el equipo no tiene ninguno, se elige solo.
  const only = !ok && !scope.central && !scope.current && mine.length === 1 ? mine[0].id : undefined;
  useEffect(() => { if (only) setDeviceLocal(only); }, [only]);
  if (ok) return <>{children}</>;

  if (centralOk) {
    return (
      <section className="card card-pad stack local-pick" aria-labelledby="local-pick-title" style={{ maxWidth: 560, margin: '24px auto' }}>
        <h1 id="local-pick-title" className="row" style={{ gap: 10, margin: 0, fontSize: '1.4rem' }}><Building size={24} aria-hidden /> ¿Qué local querés operar?</h1>
        <p className="muted" style={{ margin: 0 }}>Estás en la <b>Central</b>, viendo todos los locales. Para cargar pedidos, cobrar o manejar la caja, elegí el local.</p>
        <PickList outlets={scope.outlets} onPick={setCentralView} />
      </section>
    );
  }
  return (
    <section className="card card-pad stack local-pick" aria-labelledby="local-pick-title" style={{ maxWidth: 560, margin: '24px auto' }}>
      <h1 id="local-pick-title" className="row" style={{ gap: 10, margin: 0, fontSize: '1.4rem' }}><Store size={24} aria-hidden /> ¿En qué local trabaja este equipo?</h1>
      {scope.current && <p style={{ margin: 0 }}>Este equipo está en <b>{scope.current.name}</b>, y vos no trabajás en ese local.</p>}
      {scope.central && !admin && <p style={{ margin: 0 }}>Este equipo es la <b>Central</b>: sólo la usan los administradores.</p>}
      <p className="muted" style={{ margin: 0 }}>Cada local tiene sus mesas, su carta, sus ventas, su caja y sus facturas. Elegí el de esta compu (después se cambia en Configuración → Locales).</p>
      {mine.length === 0 ? (
        <p style={{ margin: 0 }}>No tenés locales asignados. Pedile al administrador que te asigne uno en Usuarios.</p>
      ) : (
        <PickList outlets={mine} onPick={setDeviceLocal} />
      )}
      {admin && (
        <p className="small muted" style={{ margin: 0 }}>
          ¿Es la compu de la administración? <button type="button" className="btn btn-sm" onClick={() => setDeviceLocal(CENTRAL)}><Building size={16} aria-hidden /> Usar como Central (todos los locales)</button>
          {' '}Los locales se cargan en <Link to="/configuracion/locales">Configuración → Locales</Link>.
        </p>
      )}
    </section>
  );
}

function PickList({ outlets, onPick }: { outlets: Outlet[]; onPick: (id: ID) => void }) {
  return (
    <div className="local-pick-list">
      {outlets.map((o) => (
        <button key={o.id} type="button" className="btn local-pick-btn" onClick={() => onPick(o.id)}>
          <span className="local-pick-code">{o.code ?? '·'}</span>
          <span>{o.name}</span>
          {o.ptoVta ? <span className="small muted">PV {o.ptoVta}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Chip con el local del equipo (en el encabezado). En la Central, para elegir qué local mirar. */
export function LocalChip() {
  const scope = useLocalScope();
  if (scope.central && scope.outlets.length) {
    return (
      <label className="local-chip is-central" title="Central: qué local mirar">
        <Building size={16} aria-hidden />
        <span className="sr-only">Central: local a mirar</span>
        <select aria-label="Central: local a mirar" value={scope.current?.id ?? ''} onChange={(e) => setCentralView(e.target.value || undefined)}>
          <option value="">Central · todos</option>
          {scope.outlets.map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} · ` : ''}{o.name}</option>)}
        </select>
      </label>
    );
  }
  if (!scope.current) return null;
  return (
    <Link to="/configuracion/locales" className="local-chip" title="Local de este equipo" aria-label={`Local de este equipo: ${scope.current.name}`}>
      <Store size={16} aria-hidden />
      <span className="truncate">{scope.current.name}</span>
    </Link>
  );
}

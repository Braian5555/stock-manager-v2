import { Building, Check, ChevronDown, Store } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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

/** Selector de la Central: qué local mirar. Lista propia (no la del sistema) con los colores de Orillas. */
function CentralPicker({ outlets, current }: { outlets: Outlet[]; current: Outlet | undefined }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const sorted = [...outlets].sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', 'es', { numeric: true }) || a.name.localeCompare(b.name, 'es'));
  const options: { id: string; outlet?: Outlet }[] = [{ id: '' }, ...sorted.map((o) => ({ id: o.id, outlet: o }))];
  const selected = Math.max(0, options.findIndex((o) => o.id === (current?.id ?? '')));

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    list.current?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, hi]);

  const show = () => { setHi(selected); setOpen(true); };
  const pick = (i: number) => { setCentralView(options[i].id || undefined); setOpen(false); btn.current?.focus(); };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setHi((i) => Math.min(last, i + 1)),
      ArrowUp: () => setHi((i) => Math.max(0, i - 1)),
      Home: () => setHi(0),
      End: () => setHi(last),
      Enter: () => pick(hi),
      ' ': () => pick(hi),
      Escape: () => { setOpen(false); btn.current?.focus(); },
      Tab: () => setOpen(false),
    };
    const fn = keys[e.key];
    if (!fn) return;
    if (e.key !== 'Tab') e.preventDefault();
    fn();
  };

  return (
    <div ref={wrap} className="central-picker">
      <button ref={btn} type="button" className={`local-chip is-central${current ? ' has-local' : ''}`} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Central: local a mirar: ${current ? current.name : 'todos los locales'}`} title="Central: qué local mirar"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); } }}>
        {current ? <Store size={16} aria-hidden /> : <Building size={16} aria-hidden />}
        <span className="truncate">{current ? current.name : <><span className="central-picker-pre">Central · </span>todos</>}</span>
        <ChevronDown size={16} aria-hidden className="central-picker-caret" />
      </button>
      {open && (
        <div className="central-picker-panel">
          <p className="central-picker-title" id="central-picker-title">¿Qué local mirar?</p>
          <ul ref={list} role="listbox" tabIndex={-1} aria-labelledby="central-picker-title" aria-activedescendant={`central-opt-${hi}`} onKeyDown={onListKey}>
            {options.map((o, i) => (
              <li key={o.id || 'all'} id={`central-opt-${i}`} data-i={i} role="option" aria-selected={i === selected}
                className={`central-picker-opt${i === hi ? ' is-hi' : ''}${i === selected ? ' is-sel' : ''}${i === 0 ? ' is-all' : ''}`}
                onPointerMove={() => setHi(i)} onClick={() => pick(i)}>
                <span className="central-picker-code" aria-hidden>{o.outlet ? o.outlet.code ?? '·' : <Building size={16} />}</span>
                <span className="central-picker-name">
                  {o.outlet ? o.outlet.name : 'Todos los locales'}
                  {o.outlet?.ptoVta ? <span className="central-picker-sub">PV {o.outlet.ptoVta}</span> : null}
                  {!o.outlet ? <span className="central-picker-sub">Resumen de la Central</span> : null}
                </span>
                {i === selected && <Check size={18} aria-hidden className="central-picker-check" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Chip con el local del equipo (en el encabezado). En la Central, para elegir qué local mirar. */
export function LocalChip() {
  const scope = useLocalScope();
  if (scope.central && scope.outlets.length) return <CentralPicker outlets={scope.outlets} current={scope.current} />;
  if (!scope.current) return null;
  return (
    <Link to="/configuracion/locales" className="local-chip" title="Local de este equipo" aria-label={`Local de este equipo: ${scope.current.name}`}>
      <Store size={16} aria-hidden />
      <span className="truncate">{scope.current.name}</span>
    </Link>
  );
}

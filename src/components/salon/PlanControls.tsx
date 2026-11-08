import { Check, ChevronDown, Layers, Lock, LockOpen, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DiningTable, FloorPlanConfig, ZonePlan } from '../../models';
import { applyLayout, deleteLayout, matchesLayout, saveLayout, setPlanLocked } from '../../services/floorPlanService';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useFeedback } from '../../store/feedback';
import { Modal } from '../ui/Modal';
import { useSession } from '../../store/session';

const QUICK_NAMES = ['Día', 'Noche', 'Evento', 'Temporada alta'];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

/**
 * Armados del plano: el sector guardado de distintas maneras ("Día", "Noche", "Evento") para
 * cambiarlo entero de un toque. Guardar y borrar es de quien arma el plano; usar uno, de todos
 * (si el plano no está bloqueado).
 */
export function LayoutMenu({ zone, plan, tables, locked }: { zone: string; plan: ZonePlan; tables: DiningTable[]; locked: boolean }) {
  const { run, notify, confirm } = useFeedback();
  const { can } = useSession();
  const canPlan = can('salon.plan');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const layouts = plan.layouts ?? [];
  const current = layouts.find((l) => l.id === plan.layoutId);
  const dirty = current ? !matchesLayout(current, plan, tables) : false;
  const savedSomewhere = layouts.some((l) => matchesLayout(l, plan, tables));
  const narrow = useMediaQuery('(max-width: 639px)');

  useEffect(() => {
    if (!open || narrow) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node) && !(e.target as Element).closest?.('[role="dialog"]:not(.plan-menu-panel), [role="alertdialog"]')) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]:not(.plan-menu-panel), [role="alertdialog"]')) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open, narrow]);

  const use = async (id: string, label: string) => {
    const revert = id === plan.layoutId;
    if (layouts.length && !savedSomewhere && tables.length && !(await confirm(revert
      ? { title: `Volver a “${label}”`, message: 'Los cambios que le hiciste al plano se pierden y las mesas vuelven a donde estaban.', confirmLabel: 'Volver' }
      : { title: `Cambiar a “${label}”`, message: 'El plano como está ahora no está guardado como armado: si cambiás, se pierde esa ubicación de las mesas. ¿Cambiar igual?', confirmLabel: 'Cambiar' }))) return;
    await run(async () => { await applyLayout(zone, id); notify(`Plano: ${label}`); setOpen(false); });
  };
  const save = (n = name) => void run(async () => {
    const l = await saveLayout(zone, n, tables);
    setName('');
    notify(`Armado “${l.name}” guardado`);
  });
  const remove = async (id: string, label: string) => {
    if (!(await confirm({ title: `Borrar el armado “${label}”`, message: 'Las mesas quedan donde están; sólo se borra este armado guardado.', danger: true, confirmLabel: 'Borrar' }))) return;
    await run(() => deleteLayout(zone, id), 'Armado borrado');
  };

  const body = (<>
          {layouts.length === 0 ? (
      <p className="plan-menu-empty">Guardá cómo está el plano para volver a él de un toque: de día, de noche, para un evento…</p>
    ) : (
      <ul className="plan-menu-list">
        {layouts.map((l) => {
          const inUse = l.id === plan.layoutId;
          return (
            <li key={l.id} className={`plan-menu-item${inUse ? ' is-current' : ''}`}>
              <span className="plan-menu-mark" aria-hidden>{inUse ? <Check size={16} /> : null}</span>
              <span className="plan-menu-name">
                <b>{l.name}</b>
                <span className="plan-menu-sub">{inUse ? (dirty ? 'En uso · con cambios' : 'En uso') : `Guardado ${fmtDate(l.savedAt)}`} · {Object.keys(l.tables).length} mesas</span>
              </span>
              {inUse && dirty && (
                <button type="button" className="btn btn-sm" disabled={locked} title={locked ? 'El plano está bloqueado' : 'Deja el plano como estaba guardado'} onClick={() => void use(l.id, l.name)} aria-label={`Volver a ${l.name}`}>Volver</button>
              )}
              {inUse && dirty && canPlan && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => save(l.name)} aria-label={`Guardar los cambios en ${l.name}`}><Save size={16} aria-hidden /> Guardar</button>
              )}
              {!inUse && (
                <button type="button" className="btn btn-sm btn-primary" disabled={locked} title={locked ? 'El plano está bloqueado' : undefined} onClick={() => void use(l.id, l.name)} aria-label={`Usar ${l.name}`}>Usar</button>
              )}
              {canPlan && <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Borrar el armado ${l.name}`} onClick={() => void remove(l.id, l.name)}><Trash2 size={16} aria-hidden /></button>}
            </li>
          );
        })}
      </ul>
    )}
    {locked && <p className="plan-menu-note"><Lock size={14} aria-hidden /> Plano bloqueado: para cambiar de armado, desbloquealo.</p>}
    {canPlan ? (
      <form className="plan-menu-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="plan-menu-label" htmlFor="plan-layout-name">Guardar el plano como está</label>
        <div className="row" style={{ gap: 6 }}>
          <input id="plan-layout-name" className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Nombre del armado" />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>Guardar</button>
        </div>
        <div className="plan-menu-quick" role="group" aria-label="Nombres rápidos">
          {QUICK_NAMES.filter((q) => !layouts.some((l) => l.name.toLocaleLowerCase('es') === q.toLocaleLowerCase('es'))).map((q) => (
            <button key={q} type="button" className="group-chip" onClick={() => setName(q)}>{q}</button>
          ))}
        </div>
      </form>
    ) : (
      <p className="plan-menu-note">Los armados los guarda un encargado.</p>
    )}
  </>);

  return (
    <div ref={wrap} className="plan-menu">
      <button type="button" className="btn btn-sm plan-menu-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={`Armados del plano${current ? `: ${current.name}${dirty ? ' (con cambios)' : ''}` : ''}`}>
        <Layers size={16} aria-hidden />
        <span className="truncate">{current ? current.name : 'Armados'}</span>
        {dirty && <span className="plan-menu-dot" aria-hidden title="Con cambios sin guardar" />}
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && !narrow && (
        <div className="plan-menu-panel" role="dialog" aria-label={`Armados de ${zone}`}>
          <p className="plan-menu-title">Armados de {zone}</p>
          {body}
        </div>
      )}
      {open && narrow && <Modal open title={`Armados de ${zone}`} onClose={() => setOpen(false)}><div className="plan-menu-sheet">{body}</div></Modal>}
    </div>
  );
}

/** Candado del plano: bloqueado, nadie mueve las mesas ni cambia el plano hasta que un encargado lo abra. */
export function LockButton({ cfg, onLock }: { cfg: FloorPlanConfig; onLock?: () => void }) {
  const { run, notify } = useFeedback();
  const { can, user } = useSession();
  const locked = !!cfg.locked;
  const allowed = can('salon.plan');
  const toggle = () => {
    if (!allowed) { notify(locked ? 'El plano lo desbloquea un encargado.' : 'El plano lo bloquea un encargado.'); return; }
    void run(async () => {
      await setPlanLocked(!locked, user?.name);
      if (!locked) onLock?.();
      notify(locked ? 'Plano desbloqueado' : 'Plano bloqueado: nadie mueve las mesas');
    });
  };
  const by = cfg.locked?.by ? ` por ${cfg.locked.by}` : '';
  return (
    <button type="button" className={`btn btn-sm plan-lock${locked ? ' is-locked' : ''}`} aria-pressed={locked} onClick={toggle}
      aria-label={locked ? 'Desbloquear plano' : 'Bloquear plano'} title={locked ? `Bloqueado${by}. Tocá para desbloquear.` : 'Bloquear el plano para que nadie mueva las mesas'}>
      {locked ? <Lock size={16} aria-hidden /> : <LockOpen size={16} aria-hidden />}
      <span className="plan-lock-text">{locked ? 'Bloqueado' : 'Bloquear'}</span>
    </button>
  );
}

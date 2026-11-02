import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CheckCircle2, ChevronDown, Info } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { maxirestReadiness, type ReadinessCheck } from '../../integrations/maxirest/readiness';
import type { Outlet } from '../../models';
import { saveOutlet } from '../../services/transferService';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';

const ICON = { ok: CheckCircle2, warn: AlertTriangle, info: Info };
const SHOW = 60;

/**
 * Integraciones → "Preparación": qué falta para que la sincronización con Maxirest encuentre cada
 * producto y cada depósito. Sirve hoy para el Excel y deja todo listo para cuando haya API.
 */
export function ReadinessPanel() {
  const r = useLiveQuery(() => maxirestReadiness(), []);
  if (!r) return <p className="muted">Revisando…</p>;
  const pct = r.products ? Math.round((r.withCode / r.products) * 100) : 100;
  return (
    <div className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <div className="row between wrap">
          <b>{r.ready ? 'Listo para conectar Maxirest' : 'Falta completar algunos datos'}</b>
          <span className="small muted">{r.withCode} de {r.products} productos con código ({pct}%)</span>
        </div>
        <div className="progress" role="progressbar" aria-label="Productos con código de Maxirest" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Maxirest todavía no publica una API para stock. Mientras tanto se usa el Excel; con estos datos completos, el Excel entra entero y,
          cuando Maxirest habilite la conexión, se sincroniza sin tener que vincular nada a mano.
        </p>
      </div>
      {r.checks.map((c) => <CheckRow key={c.id} c={c} />)}
    </div>
  );
}

function CheckRow({ c }: { c: ReadinessCheck }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[c.level];
  const hasList = !!(c.products?.length || c.groups?.length || (c.outlets?.length && c.id === 'deposits'));
  return (
    <section className={`readiness readiness-${c.level}`} aria-label={c.title}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <Icon size={20} aria-hidden className="readiness-icon" />
        <div className="grow stack" style={{ gap: 4 }}>
          <b>{c.title}</b>
          <span className="small muted">{c.detail}</span>
          {c.id === 'transfers' && c.transfers?.length ? <Link className="small" to="/stock">Ver los puntos en Stock</Link> : null}
        </div>
        {hasList && c.id !== 'deposits' && (
          <button type="button" className="btn btn-sm btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Ocultar' : 'Ver'} <ChevronDown size={15} aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined }} />
          </button>
        )}
      </div>
      {c.id === 'deposits' && c.outlets?.length ? <DepositNames outlets={c.outlets} /> : null}
      {open && c.products && (
        <ul className="readiness-list">
          {c.products.slice(0, SHOW).map((p) => (
            <li key={p.id} className="row between"><span className="truncate">{p.name}{p.sku ? <span className="muted"> · {p.sku}</span> : null}</span><Link className="small" to={`/productos?editar=${p.id}`}>Completar</Link></li>
          ))}
          {c.products.length > SHOW && <li className="small muted">y {c.products.length - SHOW} más</li>}
        </ul>
      )}
      {open && c.groups && (
        <ul className="readiness-list">
          {c.groups.map((g) => (
            <li key={g.code}><b>{g.code}</b>: {g.products.map((p, i) => <span key={p.id}>{i ? ', ' : ''}<Link to={`/productos?editar=${p.id}`}>{p.name}</Link></span>)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Nombre de cada punto en Maxirest (se guarda al salir del campo). */
function DepositNames({ outlets }: { outlets: Outlet[] }) {
  const { can } = useSession();
  const { run } = useFeedback();
  const editable = can('admin') || can('stock.move');
  return (
    <ul className="readiness-list">
      {outlets.map((o) => (
        <li key={o.id} className="row" style={{ gap: 8 }}>
          <span className="grow truncate">{o.name}</span>
          {editable ? (
            <input className="input" style={{ maxWidth: 220 }} defaultValue={o.maxirestName ?? ''} placeholder="Depósito en Maxirest" aria-label={`Depósito de Maxirest de ${o.name}`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (o.maxirestName ?? '')) void run(() => saveOutlet({ id: o.id, name: o.name, maxirestName: v, active: o.active }), 'Guardado'); }} />
          ) : <span className="muted">{o.maxirestName || '—'}</span>}
        </li>
      ))}
    </ul>
  );
}

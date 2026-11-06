import { Circle, Move, RectangleHorizontal, Square } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { minutesSince, sinceLabel } from '../../hooks/useNow';
import type { DiningTable, TableShape, TableTicket } from '../../models';
import { KITCHEN_WARN_MIN, placeTable, waitingSince } from '../../services/salonService';
import { useFeedback } from '../../store/feedback';
import { fmtMoney } from '../../utils/format';

export type TableState = 'libre' | 'ocupada' | 'listo' | 'cuenta';
export const STATE_LABEL: Record<TableState, string> = { libre: 'Libre', ocupada: 'Ocupada', listo: 'Listo para llevar', cuenta: 'Pidió la cuenta' };

export function tableState(k?: TableTicket): TableState {
  if (!k) return 'libre';
  if (k.status === 'cuenta') return 'cuenta';
  return k.lines.some((l) => l.status === 'listo' && l.qty > 0) ? 'listo' : 'ocupada';
}

/** Posición por defecto (grilla) para mesas que todavía no se ubicaron. */
const autoPos = (i: number) => ({ x: 10 + (i % 6) * 16, y: 20 + Math.floor(i / 6) * 27 });

/**
 * Plano del sector: las mesas donde están en el local, con el color de su estado.
 * En modo edición se arrastran (o se mueven con las flechas) y se les cambia forma y tamaño.
 */
export function FloorPlan({ tables, byTable, now, editing, onTap }: {
  tables: DiningTable[]; byTable: Map<string, TableTicket>; now: number; editing: boolean; onTap: (t: DiningTable) => void;
}) {
  const { run } = useFeedback();
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const pos = (t: DiningTable, i: number) => (drag?.id === t.id ? drag : t.x !== undefined && t.y !== undefined ? { x: t.x, y: t.y } : autoPos(i));
  const sel = tables.find((t) => t.id === selected);

  const toPct = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const snap = (v: number) => Math.round(Math.min(97, Math.max(3, v)));
    return { x: snap(((e.clientX - r.left) / r.width) * 100), y: snap(((e.clientY - r.top) / r.height) * 100) };
  };
  const down = (e: PointerEvent<HTMLButtonElement>, t: DiningTable) => {
    if (!editing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(t.id);
    setDrag({ id: t.id, ...toPct(e) });
  };
  const move = (e: PointerEvent) => { if (drag) setDrag({ id: drag.id, ...toPct(e) }); };
  const up = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    void run(() => placeTable(d.id, { x: d.x, y: d.y }));
  };
  const key = (e: KeyboardEvent<HTMLButtonElement>, t: DiningTable, i: number) => {
    if (!editing) return;
    const step = e.shiftKey ? 5 : 1;
    const p = pos(t, i);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    void run(() => placeTable(t.id, { x: p.x + d[0], y: p.y + d[1] }));
  };

  return (
    <div className="salon-plan-wrap">
      {editing && (
        <div className="salon-plan-tools" role="toolbar" aria-label="Editar mesa">
          <span className="small"><Move size={16} aria-hidden /> {sel ? `Mesa ${sel.name}` : 'Arrastrá las mesas o tocá una para cambiarle la forma'}</span>
          {sel && (<>
            <span className="group-chips" role="group" aria-label="Forma">
              {([['cuadrada', Square], ['redonda', Circle], ['rectangular', RectangleHorizontal]] as [TableShape, typeof Square][]).map(([s, Icon]) => (
                <button key={s} type="button" className="group-chip" aria-pressed={(sel.shape ?? 'cuadrada') === s} onClick={() => void run(() => placeTable(sel.id, { shape: s }))}><Icon size={14} aria-hidden /> {s[0].toUpperCase() + s.slice(1)}</button>
              ))}
            </span>
            <span className="group-chips" role="group" aria-label="Tamaño">
              {([1, 2, 3] as const).map((n) => (
                <button key={n} type="button" className="group-chip" aria-pressed={(sel.size ?? 2) === n} onClick={() => void run(() => placeTable(sel.id, { size: n }))}>{['Chica', 'Mediana', 'Grande'][n - 1]}</button>
              ))}
            </span>
          </>)}
        </div>
      )}
      <div className="salon-plan-scroll">
        <div ref={ref} className={`salon-plan${editing ? ' is-editing' : ''}`} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Plano del salón" role="group">
          {tables.map((t, i) => {
            const k = byTable.get(t.id);
            const state = tableState(k);
            const p = pos(t, i);
            const wait = k ? minutesSince(waitingSince(k), now) : 0;
            const late = wait >= KITCHEN_WARN_MIN;
            return (
              <button key={t.id} type="button"
                className={`salon-ptable is-${state} shape-${t.shape ?? 'cuadrada'} size-${t.size ?? 2}${selected === t.id && editing ? ' is-selected' : ''}${late && !editing ? ' is-late' : ''}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                aria-label={`Mesa ${t.name}: ${STATE_LABEL[state]}${late ? `, cocina demora ${Math.floor(wait)} min` : ''}`}
                onPointerDown={(e) => down(e, t)}
                onKeyDown={(e) => key(e, t, i)}
                onClick={() => (editing ? setSelected(t.id) : onTap(t))}>
                <span className="salon-ptable-name">{t.name}</span>
                {k && !editing && <span className="salon-ptable-meta num">{fmtMoney(k.total)}</span>}
                {k && !editing && <span className="salon-ptable-time">{sinceLabel(k.openedAt, now)}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {!editing && (
        <ul className="salon-legend" aria-label="Referencias">
          {(Object.keys(STATE_LABEL) as TableState[]).map((s) => <li key={s}><span className={`salon-dot is-${s}`} aria-hidden /> {STATE_LABEL[s]}</li>)}
        </ul>
      )}
    </div>
  );
}

import {
  Banknote, Bath, ChefHat, Circle, DoorOpen, LayoutGrid, Lock, Move, RectangleHorizontal, RotateCw, Sprout, Square, Trash2, Umbrella, Undo2,
  Waves, Wine, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { minutesSince, sinceLabel } from '../../hooks/useNow';
import type { DiningTable, FixtureKind, FloorFixture, FloorStyle, TableShape, TableTicket, ZonePlan } from '../../models';
import {
  addFixture, applySnapshot, FIXTURE_LABEL, FLOOR_STYLES, gridSpots, LONG_FIXTURES, removeFixture, setZoneFloor, updateFixture, type PlanSnapshot,
} from '../../services/floorPlanService';
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

export const FIXTURE_ICON: Record<FixtureKind, LucideIcon | null> = {
  barra: Wine, caja: Banknote, cocina: ChefHat, entrada: DoorOpen, bano: Bath, pared: null, ventanal: null, planta: Sprout, sombrilla: Umbrella, mar: Waves,
};
const FIXTURE_ORDER: FixtureKind[] = ['barra', 'caja', 'cocina', 'entrada', 'bano', 'pared', 'ventanal', 'planta', 'sombrilla', 'mar'];
const SIZE_LABEL = ['Chico', 'Mediano', 'Grande'] as const;

type Pick = { type: 'table' | 'fixture'; id: string };
type Drag = Pick & { x: number; y: number; ox: number; oy: number; sx: number; sy: number; moved: boolean };

/**
 * Plano del sector: las mesas donde están en el local, con el color de su estado, sobre su piso y
 * con los elementos fijos (barra, caja, entrada, el mar…) para ubicarse.
 * En modo edición se arrastran (o se mueven con las flechas), se cambia el piso, se agregan
 * elementos, se acomoda todo en filas y se deshace el último cambio.
 */
export function FloorPlan({ tables, zone, plan, byTable, now, editing, locked, onTap }: {
  tables: DiningTable[]; zone: string; plan: ZonePlan; byTable: Map<string, TableTicket>; now: number; editing: boolean; locked?: boolean;
  onTap: (t: DiningTable) => void;
}) {
  const { run } = useFeedback();
  const ref = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [undo, setUndo] = useState<PlanSnapshot[]>([]);
  const fixtures = plan.fixtures ?? [];
  const floor: FloorStyle = plan.floor ?? 'puntos';

  // Al salir de la edición o cambiar de sector, se empieza de nuevo.
  useEffect(() => { setUndo([]); setPicked(null); }, [editing, zone]);

  const pos = (t: DiningTable, i: number) => (drag?.type === 'table' && drag.id === t.id ? drag : t.x !== undefined && t.y !== undefined ? { x: t.x, y: t.y } : autoPos(i));
  const fpos = (f: FloorFixture) => (drag?.type === 'fixture' && drag.id === f.id ? drag : f);
  const selTable = picked?.type === 'table' ? tables.find((t) => t.id === picked.id) : undefined;
  const selFixture = picked?.type === 'fixture' ? fixtures.find((f) => f.id === picked.id) : undefined;

  /** Foto de cómo está el sector, para poder deshacer. */
  const snapshot = (): PlanSnapshot => ({
    tables: Object.fromEntries(tables.map((t, i) => { const p = pos(t, i); return [t.id, { x: p.x, y: p.y, shape: t.shape ?? 'cuadrada', size: t.size ?? 2 }]; })),
    fixtures: structuredClone(fixtures),
    ...(plan.floor ? { floor: plan.floor } : {}),
  });
  const change = (fn: () => Promise<unknown>) => {
    const before = snapshot();
    void run(async () => { await fn(); setUndo((u) => [...u.slice(-29), before]); });
  };
  const undoLast = () => {
    const last = undo.at(-1);
    if (!last) return;
    void run(async () => { await applySnapshot(zone, last); setUndo((u) => u.slice(0, -1)); });
  };

  /** Puntero en % del plano (sin redondear). */
  const pct = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100, w: r.width };
  };
  const down = (e: PointerEvent<HTMLElement>, p: Pick, cur: { x: number; y: number }) => {
    if (!editing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPicked(p);
    const at = pct(e);
    setDrag({ ...p, x: cur.x, y: cur.y, ox: cur.x, oy: cur.y, sx: at.x, sy: at.y, moved: false });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const at = pct(e);
    const dx = at.x - drag.sx;
    const dy = at.y - drag.sy;
    // Un toque no mueve: hay que arrastrar unos píxeles.
    if (!drag.moved && Math.hypot((dx * at.w) / 100, (dy * at.w) / 100) < 5) return;
    const clamp = (v: number) => Math.round(Math.min(97, Math.max(3, v)));
    setDrag({ ...drag, x: clamp(drag.ox + dx), y: clamp(drag.oy + dy), moved: true });
  };
  const up = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved || (d.x === d.ox && d.y === d.oy)) return; // sólo lo tocó
    change(() => (d.type === 'table' ? placeTable(d.id, { x: d.x, y: d.y }) : updateFixture(zone, d.id, { x: d.x, y: d.y })));
  };
  const key = (e: KeyboardEvent<HTMLElement>, p: Pick, cur: { x: number; y: number }) => {
    if (!editing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && p.type === 'fixture') { e.preventDefault(); change(() => removeFixture(zone, p.id)); setPicked(null); return; }
    const step = e.shiftKey ? 5 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    setPicked(p);
    const next = { x: cur.x + d[0], y: cur.y + d[1] };
    change(() => (p.type === 'table' ? placeTable(p.id, next) : updateFixture(zone, p.id, next)));
  };
  const add = (kind: FixtureKind) => {
    const before = snapshot();
    void run(async () => { const f = await addFixture(zone, kind); setUndo((u) => [...u.slice(-29), before]); setPicked({ type: 'fixture', id: f.id }); });
  };
  const arrange = () => change(() => applySnapshot(zone, { tables: gridSpots(tables), fixtures, ...(plan.floor ? { floor: plan.floor } : {}) }));

  return (
    <div className="salon-plan-wrap">
      {editing && (
        <div className="plan-workshop" role="toolbar" aria-label="Editar plano">
          <div className="plan-ws-row plan-ws-selected" aria-live="polite">
            {selTable ? (<>
              <span className="plan-ws-what"><Move size={16} aria-hidden /> Mesa {selTable.name}</span>
              <span className="group-chips" role="group" aria-label="Forma">
                {([['cuadrada', Square], ['redonda', Circle], ['rectangular', RectangleHorizontal]] as [TableShape, LucideIcon][]).map(([s, Icon]) => (
                  <button key={s} type="button" className="group-chip" aria-pressed={(selTable.shape ?? 'cuadrada') === s} onClick={() => change(() => placeTable(selTable.id, { shape: s }))}><Icon size={14} aria-hidden /> {s[0].toUpperCase() + s.slice(1)}</button>
                ))}
              </span>
              <span className="group-chips" role="group" aria-label="Tamaño">
                {([1, 2, 3] as const).map((n) => (
                  <button key={n} type="button" className="group-chip" aria-pressed={(selTable.size ?? 2) === n} onClick={() => change(() => placeTable(selTable.id, { size: n }))}>{['Chica', 'Mediana', 'Grande'][n - 1]}</button>
                ))}
              </span>
            </>) : selFixture ? (<>
              <span className="plan-ws-what"><Move size={16} aria-hidden /> {FIXTURE_LABEL[selFixture.kind]}</span>
              <span className="group-chips" role="group" aria-label="Tamaño del elemento">
                {([1, 2, 3] as const).map((n) => (
                  <button key={n} type="button" className="group-chip" aria-pressed={(selFixture.size ?? 2) === n} onClick={() => change(() => updateFixture(zone, selFixture.id, { size: n }))}>{SIZE_LABEL[n - 1]}</button>
                ))}
              </span>
              {LONG_FIXTURES.has(selFixture.kind) && (
                <button type="button" className="btn btn-sm" onClick={() => change(() => updateFixture(zone, selFixture.id, { vertical: !selFixture.vertical }))}><RotateCw size={16} aria-hidden /> Girar</button>
              )}
              <button type="button" className="btn btn-sm btn-ghost plan-ws-remove" onClick={() => { change(() => removeFixture(zone, selFixture.id)); setPicked(null); }}><Trash2 size={16} aria-hidden /> Quitar</button>
            </>) : (
              <span className="plan-ws-what muted"><Move size={16} aria-hidden /> Arrastrá mesas y elementos. Tocá uno para cambiarlo.</span>
            )}
            <span className="plan-ws-actions">
              <button type="button" className="btn btn-sm" onClick={arrange} title="Pone las mesas en filas parejas"><LayoutGrid size={16} aria-hidden /> Acomodar en filas</button>
              <button type="button" className="btn btn-sm" onClick={undoLast} disabled={!undo.length}><Undo2 size={16} aria-hidden /> Deshacer</button>
            </span>
          </div>
          <div className="plan-ws-row">
            <span className="plan-ws-label" id="plan-floor-label">Piso</span>
            <span className="plan-floors" role="group" aria-labelledby="plan-floor-label">
              {FLOOR_STYLES.map((f) => (
                <button key={f.value} type="button" className="plan-floor-btn" aria-pressed={floor === f.value} onClick={() => change(() => setZoneFloor(zone, f.value))}>
                  <span className={`plan-floor-swatch floor-${f.value}`} aria-hidden />{f.label}
                </button>
              ))}
            </span>
          </div>
          <div className="plan-ws-row">
            <span className="plan-ws-label" id="plan-add-label">Agregar</span>
            <span className="plan-adds" role="group" aria-labelledby="plan-add-label">
              {FIXTURE_ORDER.map((k) => {
                const Icon = FIXTURE_ICON[k];
                return (
                  <button key={k} type="button" className="plan-add-btn" onClick={() => add(k)} aria-label={`Agregar ${FIXTURE_LABEL[k].toLowerCase()}`}>
                    {Icon ? <Icon size={16} aria-hidden /> : <span className={`plan-add-line kind-${k}`} aria-hidden />}{FIXTURE_LABEL[k]}
                  </button>
                );
              })}
            </span>
          </div>
        </div>
      )}
      <div className="salon-plan-scroll">
        <div ref={ref} className={`salon-plan floor-${floor}${editing ? ' is-editing' : ''}`} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Plano del salón" role="group">
          {locked && !editing && <span className="plan-locked-badge"><Lock size={14} aria-hidden /> Bloqueado</span>}
          {fixtures.map((f) => {
            const p = fpos(f);
            const Icon = FIXTURE_ICON[f.kind];
            const cls = `salon-fixture kind-${f.kind} fsize-${f.size ?? 2}${f.vertical ? ' is-vertical' : ''}`;
            const inner = (<>{Icon && <Icon size={f.kind === 'planta' || f.kind === 'sombrilla' ? 18 : 16} aria-hidden />}{!['pared', 'ventanal', 'planta', 'sombrilla'].includes(f.kind) && <span className="salon-fixture-name">{FIXTURE_LABEL[f.kind]}</span>}</>);
            return editing ? (
              <button key={f.id} type="button" className={`${cls}${picked?.id === f.id ? ' is-selected' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}
                aria-label={`Elemento: ${FIXTURE_LABEL[f.kind]}`} onPointerDown={(e) => down(e, { type: 'fixture', id: f.id }, f)}
                onKeyDown={(e) => key(e, { type: 'fixture', id: f.id }, f)} onClick={() => setPicked({ type: 'fixture', id: f.id })}>{inner}</button>
            ) : (
              <div key={f.id} className={cls} style={{ left: `${p.x}%`, top: `${p.y}%` }} role="img" aria-label={FIXTURE_LABEL[f.kind]}>{inner}</div>
            );
          })}
          {tables.map((t, i) => {
            const k = byTable.get(t.id);
            const state = tableState(k);
            const p = pos(t, i);
            const wait = k ? minutesSince(waitingSince(k), now) : 0;
            const late = wait >= KITCHEN_WARN_MIN;
            return (
              <button key={t.id} type="button"
                className={`salon-ptable is-${state} shape-${t.shape ?? 'cuadrada'} size-${t.size ?? 2}${picked?.id === t.id && editing ? ' is-selected' : ''}${late && !editing ? ' is-late' : ''}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                aria-label={`Mesa ${t.name}: ${STATE_LABEL[state]}${late ? `, cocina demora ${Math.floor(wait)} min` : ''}`}
                onPointerDown={(e) => down(e, { type: 'table', id: t.id }, p)}
                onKeyDown={(e) => key(e, { type: 'table', id: t.id }, p)}
                onClick={() => (editing ? setPicked({ type: 'table', id: t.id }) : onTap(t))}>
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

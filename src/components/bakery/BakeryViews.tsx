import { useToday } from '../../hooks/useToday';
import { CheckCircle2, ClipboardList, Copy, FileSpreadsheet, Lock, Pencil, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Lookups } from '../../hooks/useData';
import type { Product, StockMovement } from '../../models';
import { bakerySummary, closeDay, closedOn, planOf, savePlan, ymdAdd } from '../../services/bakeryService';
import { downloadBlob, stamp } from '../../exports/download';
import { toXlsx } from '../../exports/writers';
import { useFeedback } from '../../store/feedback';
import { fmtDateTime, fmtNumber, localYmd, matches } from '../../utils/format';
import { Stepper } from '../Stepper';
import { EmptyState, NumberInput, Segmented } from '../ui';
import { Modal } from '../ui/Modal';

interface Common { products: Product[]; lk: Lookups; movements: StockMovement[] }
const unitOf = (lk: Lookups, p?: Product) => lk.unit(p?.unitId) || 'u';
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Productos que suelen elaborarse: con receta, de familias de panadería/elaboración o ya planificados. */
function isBakeryCandidate(p: Product, lk: Lookups) {
  return !!p.recipe?.items.length || /panad|pastel|elabor|produc|confit/i.test(lk.category(p.categoryId)) || !!Object.keys(p.productionPlan ?? {}).length;
}

// ───────────────────────── Plan del día ─────────────────────────

/**
 * Plan del día: qué hay que hacer y cuánto va hecho. Se tilda solo con lo que se anota en
 * "Anotar". Quien administra arma el plan de hoy o de mañana.
 */
export function PlanView({ products, lk, movements, canEdit, onPick }: Common & { canEdit: boolean; onPick: (p: Product, remaining?: number) => void }) {
  const today = useToday();
  const [date, setDate] = useState(today);
  // A la medianoche el plan pasa solo al día nuevo.
  useEffect(() => setDate(today), [today]);
  const [editing, setEditing] = useState(false);
  const summary = useMemo(() => bakerySummary(movements, products, date, date), [movements, products, date]);
  const produced = useMemo(() => new Map(summary.rows.map((r) => [r.productId, r.produced])), [summary]);
  const planned = products.filter((p) => planOf(p, date) > 0).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const done = planned.filter((p) => (produced.get(p.id) ?? 0) >= planOf(p, date)).length;
  const isToday = date === today;

  return (
    <div className="stack">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <Segmented label="Día del plan" value={date} onChange={setDate} options={[{ value: today, label: 'Hoy' }, { value: ymdAdd(today, 1), label: 'Mañana' }]} />
        {canEdit && <button type="button" className="btn" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden /> {planned.length ? 'Editar plan' : 'Armar plan'}</button>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {dayLabel(date)}{planned.length ? ` · ${done} de ${planned.length} listos` : ''}
      </p>
      {planned.length === 0 ? (
        <div className="card">
          <EmptyState icon={<ClipboardList size={36} />} title={`No hay plan para ${isToday ? 'hoy' : 'mañana'}`}>
            {canEdit ? 'Tocá “Armar plan” y cargá qué hay que hacer y cuánto.' : 'Cuando el encargado cargue el plan, aparece acá.'}
          </EmptyState>
        </div>
      ) : (
        <div className="card list" role="list" aria-label="Plan del día">
          {planned.map((p) => {
            const goal = planOf(p, date);
            const made = produced.get(p.id) ?? 0;
            const ok = made >= goal;
            const pct = Math.min(100, (made / goal) * 100);
            const Row = isToday ? 'button' : 'div';
            return (
              <Row key={p.id} role="listitem" type={isToday ? 'button' : undefined} className={`list-item plan-row ${ok ? 'done' : ''}`} onClick={isToday ? () => onPick(p, ok ? undefined : Math.max(0, goal - made)) : undefined}>
                {ok ? <CheckCircle2 size={22} className="plan-check" aria-label="Listo" /> : <span className="plan-dot" aria-hidden />}
                <span className="grow">
                  <span className="list-title">{p.name}</span>
                  <span className="plan-bar" aria-hidden><i style={{ width: `${pct}%` }} /></span>
                </span>
                <span className="num plan-count"><b>{fmtNumber(made)}</b> / {fmtNumber(goal)} {unitOf(lk, p)}</span>
              </Row>
            );
          })}
        </div>
      )}
      {isToday && planned.length > 0 && <p className="small muted">Tocá un producto para anotar lo que se hizo; se tilda solo al llegar a lo planificado.</p>}
      <PlanEditor open={editing} date={date} products={products} lk={lk} movements={movements} onClose={() => setEditing(false)} />
    </div>
  );
}

function PlanEditor({ open, date, products, lk, onClose }: Common & { open: boolean; date: string; onClose: () => void }) {
  const { run, notify } = useFeedback();
  const [qty, setQty] = useState<Record<string, number | undefined>>({});
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) return;
    setQ('');
    setQty(Object.fromEntries(products.filter((p) => planOf(p, date) > 0).map((p) => [p.id, planOf(p, date)])));
  }, [open, date]); // eslint-disable-line react-hooks/exhaustive-deps -- cargar al abrir

  const candidates = useMemo(() => {
    const base = q.trim() ? products.filter((p) => matches(q, p.name, p.sku)) : products.filter((p) => isBakeryCandidate(p, lk) || qty[p.id]);
    return base.sort((a, b) => Number(!!qty[b.id]) - Number(!!qty[a.id]) || a.name.localeCompare(b.name, 'es')).slice(0, 120);
  }, [products, q, lk, qty]);

  const yesterday = ymdAdd(date, -1);
  const copyYesterday = () => {
    const prev = products.filter((p) => planOf(p, yesterday) > 0);
    if (!prev.length) return notify('El día anterior no tiene plan para copiar.', { tone: 'error' });
    setQty(Object.fromEntries(prev.map((p) => [p.id, planOf(p, yesterday)])));
  };
  const save = async () => {
    // Incluye los que estaban planificados y se borraron (quedan en 0).
    const all: Record<string, number | undefined> = Object.fromEntries(products.filter((p) => planOf(p, date) > 0).map((p) => [p.id, 0]));
    Object.assign(all, qty);
    const n = await run(() => savePlan(date, all));
    if (n === undefined) return;
    notify(n ? 'Plan guardado' : 'El plan no tenía cambios');
    onClose();
  };
  const count = Object.values(qty).filter((v) => v && v > 0).length;

  return (
    <Modal open={open} wide title={`Plan de ${date === localYmd() ? 'hoy' : 'mañana'}`} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={copyYesterday}><Copy size={16} aria-hidden /> Copiar del día anterior</button>
        <span className="grow" />
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={save}>Guardar plan ({count})</button>
      </>}>
      <div className="stack">
        <label className="production-search">
          <Search size={18} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar otro producto para sumar" aria-label="Buscar producto para el plan" />
        </label>
        <div className="list">
          {candidates.map((p) => (
            <div key={p.id} className={`count-item ${(qty[p.id] ?? 0) > 0 ? 'done' : ''}`}>
              <div className="grow" style={{ minWidth: 150 }}>
                <div className="list-title">{p.name}</div>
                <div className="list-sub">{[lk.category(p.categoryId), unitOf(lk, p), p.recipe?.items.length ? 'con receta' : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <Stepper label={p.name} value={qty[p.id]} onChange={(v) => setQty((cur) => ({ ...cur, [p.id]: v }))} />
            </div>
          ))}
          {candidates.length === 0 && <p className="muted small">No hay productos con ese nombre.</p>}
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────── Cierre del día ─────────────────────────

/**
 * Cierre: por cada producto del día, cuánto sobró (queda como stock para mañana) y cuánto se
 * tiró (merma). Lo ya cerrado queda bloqueado; se corrige revirtiendo desde Movimientos.
 */
export function CloseView({ products, lk, movements }: Common) {
  const { run, confirm, notify } = useFeedback();
  const today = localYmd();
  const summary = useMemo(() => bakerySummary(movements, products, today, today), [movements, products, today]);
  const closed = useMemo(() => closedOn(movements, today), [movements, today]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const rows = summary.rows.filter((r) => r.produced > 0 || r.planned > 0 || closed.has(r.productId));
  const [vals, setVals] = useState<Record<string, { sobrante?: number; merma?: number }>>({});
  const set = (id: string, k: 'sobrante' | 'merma', v?: number) => setVals((cur) => ({ ...cur, [id]: { ...cur[id], [k]: v } }));
  const pending = rows.filter((r) => !closed.has(r.productId) && (vals[r.productId]?.sobrante !== undefined || (vals[r.productId]?.merma ?? 0) > 0));

  const save = async () => {
    if (!pending.length) return;
    const ok = await confirm({
      title: 'Guardar cierre del día',
      message: (
        <div className="stack-sm">
          {pending.map((r) => {
            const v = vals[r.productId];
            const u = unitOf(lk, byId.get(r.productId));
            return <div key={r.productId} className="result-line small"><span className="grow">{r.name}</span><span className="num">{v.sobrante !== undefined && `sobró ${fmtNumber(v.sobrante)} ${u}`}{v.sobrante !== undefined && (v.merma ?? 0) > 0 && ' · '}{(v.merma ?? 0) > 0 && `merma ${fmtNumber(v.merma)} ${u}`}</span></div>;
          })}
          <p className="small muted">Lo que sobró queda como stock para mañana; la merma se descuenta. Se registra en Movimientos.</p>
        </div>
      ),
      confirmLabel: 'Guardar cierre',
    });
    if (!ok) return;
    const r = await run(() => closeDay(today, pending.map((x) => ({ productId: x.productId, ...vals[x.productId] }))));
    if (!r) return;
    setVals({});
    notify(`Cierre guardado: ${pending.length} ${pending.length === 1 ? 'producto' : 'productos'}.`);
  };

  if (!rows.length) {
    return <div className="card"><EmptyState icon={<Lock size={36} />} title="Nada para cerrar hoy">Cuando se anote producción o haya plan para hoy, aparece acá para cargar sobrantes y mermas.</EmptyState></div>;
  }
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>{dayLabel(today)} · Anotá lo que sobró y lo que se tiró de cada producto. Si no sobró nada, poné 0.</p>
      <div className="card list" aria-label="Cierre del día">
        {rows.map((r) => {
          const p = byId.get(r.productId);
          const u = unitOf(lk, p);
          const c = closed.get(r.productId);
          return (
            <div key={r.productId} className={`count-item close-row ${c ? 'done' : ''}`}>
              <div className="grow" style={{ minWidth: 150 }}>
                <div className="list-title">{r.name}</div>
                <div className="list-sub">Hecho hoy {fmtNumber(r.produced)} {u}{r.planned ? ` de ${fmtNumber(r.planned)}` : ''} · stock {fmtNumber(p?.stock)} {u}</div>
              </div>
              {c ? (
                <span className="small close-done"><Lock size={14} aria-hidden /> Cerrado{c.sobrante !== undefined ? ` · sobró ${fmtNumber(c.sobrante)}` : ''}{c.merma ? ` · merma ${fmtNumber(c.merma)}` : ''}</span>
              ) : (
                <div className="close-inputs">
                  <label className="close-field"><span>Sobró</span><NumberInput aria-label={`Sobró de ${r.name}`} value={vals[r.productId]?.sobrante} min={0} onChange={(v) => set(r.productId, 'sobrante', v)} /></label>
                  <label className="close-field"><span>Se tiró</span><NumberInput aria-label={`Se tiró de ${r.name}`} value={vals[r.productId]?.merma} min={0} onChange={(v) => set(r.productId, 'merma', v)} /></label>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="btn btn-primary btn-block" disabled={!pending.length} onClick={save}>Guardar cierre{pending.length ? ` (${pending.length})` : ''}</button>
    </div>
  );
}

// ───────────────────────── Resumen ─────────────────────────

type Period = 'hoy' | '7' | '30';

/** Resumen por período: planificado vs. producido, merma, sobrante e insumos usados. */
export function SummaryView({ products, lk, movements }: Common) {
  const { run } = useFeedback();
  const [period, setPeriod] = useState<Period>('7');
  const to = localYmd();
  const from = period === 'hoy' ? to : ymdAdd(to, period === '7' ? -6 : -29);
  const s = useMemo(() => bakerySummary(movements, products, from, to), [movements, products, from, to]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const u = (id: string) => unitOf(lk, byId.get(id));
  const label = period === 'hoy' ? 'Hoy' : `Últimos ${period} días`;
  // Merma y sobrante sólo si en el período se cargó algún cierre.
  const withClose = s.rows.some((r) => r.merma > 0 || r.closedDays > 0);

  const excel = () =>
    run(async () => {
      const blob = await toXlsx(`Panadería · ${label}`, [
        {
          title: 'Producción',
          columns: ['Producto', 'Unidad', 'Planificado', 'Producido', ...(withClose ? ['Merma', 'Sobró', 'Días con cierre'] : []), 'Anotó'],
          rows: s.rows.map((r) => [r.name, u(r.productId), r.planned, r.produced, ...(withClose ? [r.merma, r.sobrante, r.closedDays] : []), r.people.join(', ')]),
        },
        { title: 'Insumos usados', columns: ['Insumo', 'Unidad', 'Cantidad'], rows: s.ingredients.map((i) => [i.name, u(i.productId), i.quantity]) },
        { title: 'Detalle', columns: ['Fecha y hora', 'Producto', 'Cantidad', 'Unidad', 'Anotó'], rows: s.entries.map((e) => [fmtDateTime(e.at), e.name, e.quantity, u(e.productId), e.by ?? '']) },
      ], [{ name: 'Período', lines: [`Panadería · ${label}`, `Del ${from} al ${to}`, `${s.productions} producciones anotadas`] }]);
      downloadBlob(blob, `panaderia-${period === 'hoy' ? 'hoy' : `${period}-dias`}-${stamp()}.xlsx`);
    }, 'Resumen descargado');

  return (
    <div className="stack">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <Segmented label="Período" value={period} onChange={setPeriod} options={[{ value: 'hoy', label: 'Hoy' }, { value: '7', label: '7 días' }, { value: '30', label: '30 días' }]} />
        <button type="button" className="btn" disabled={!s.rows.length} onClick={excel}><FileSpreadsheet size={16} aria-hidden /> Excel para el administrativo</button>
      </div>
      {s.rows.length === 0 ? (
        <div className="card"><EmptyState title="Sin producción en el período">Lo que se anote en Panadería aparece acá.</EmptyState></div>
      ) : (
        <>
          <section className="card" aria-label="Producción del período">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Producto</th><th className="num">Plan</th><th className="num">Hecho</th>{withClose && <><th className="num">Merma</th><th className="num">Sobró</th></>}<th>Anotó</th></tr></thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.name} <span className="muted small">{u(r.productId)}</span></td>
                      <td className="num">{r.planned ? fmtNumber(r.planned) : '—'}</td>
                      <td className={`num ${r.planned && r.produced < r.planned ? 'neg' : ''}`}><b>{fmtNumber(r.produced)}</b></td>
                      {withClose && <>
                        <td className="num">{r.merma ? fmtNumber(r.merma) : '—'}</td>
                        <td className="num">{r.closedDays ? fmtNumber(r.sobrante) : '—'}</td>
                      </>}
                      <td className="small muted">{r.people.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {s.ingredients.length > 0 && (
            <section className="card" aria-labelledby="insumos-usados">
              <div className="card-head"><h2 id="insumos-usados">Insumos usados</h2><span className="small muted">según las recetas</span></div>
              <div className="list">
                {s.ingredients.map((i) => (
                  <div key={i.productId} className="list-item"><span className="grow">{i.name}</span><b className="num">{fmtNumber(i.quantity)} {u(i.productId)}</b></div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ClipboardCheck, Copy, SlidersHorizontal, Store, Tags } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { db } from '../../database/db';
import { startCount } from '../../services/countService';
import { stockByOutlet } from '../../services/stockService';
import { outletAlerts, outletCategoryIds, setOutletCategories, setOutletMin } from '../../services/transferService';
import { Modal } from '../ui/Modal';
import { useLookups, useOutlets, useProducts } from '../../hooks/useData';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { EmptyState, NumberInput, SearchInput, Select } from '../ui';
import { fmtNumber, matches } from '../../utils/format';

/** Stock de un punto. Con `outletId` muestra ese punto fijo (sin el selector), como en la pantalla de Stock. */
export function OutletStockPanel({ outletId: fixedId }: { outletId?: string } = {}) {
  const outlets = useOutlets();
  const products = useProducts();
  const lk = useLookups();
  const { can } = useSession();
  const { run } = useFeedback();
  const navigate = useNavigate();
  const [outletId, setOutletId] = useState('');
  const [q, setQ] = useState('');
  const movements = useLiveQuery(() => db.movements.filter((m) => !!m.outletId).toArray(), []);
  const byOutlet = useMemo(() => stockByOutlet(movements ?? []), [movements]);
  const current = fixedId || outletId || outlets.find((o) => o.active)?.id || '';
  const stock = byOutlet.get(current);
  const outlet = outlets.find((o) => o.id === current);
  const cats = new Set(outletCategoryIds(outlet, lk.categories));
  const [editCats, setEditCats] = useState(false);
  const [editMins, setEditMins] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  // Mínimos que se están escribiendo: se guardan al salir del campo (no en cada tecla).
  const [draft, setDraft] = useState<Record<string, number | undefined>>({});
  const saveMin = (productId: string, typed: string) => {
    if (!outlet) return;
    const cleared = typed.trim() === '';
    if (!cleared && !(productId in draft)) return;
    const v = cleared ? undefined : draft[productId];
    setDraft((d) => { const n = { ...d }; delete n[productId]; return n; });
    if ((v ?? 0) !== (outlet.minStock?.[productId] ?? 0)) void run(() => setOutletMin(outlet.id, productId, v));
  };
  const canEdit = can('catalog.manage') || can('admin');
  const alerts = outletAlerts(outlet, stock, products);
  const alertOf = new Map(alerts.map((a) => [a.product.id, a]));
  const hasMins = Object.keys(outlet?.minStock ?? {}).length > 0;
  const outCount = alerts.filter((a) => a.level === 'out').length;
  // Lo que maneja el punto (sus familias, aunque esté en 0) más lo que recibió por remito.
  const rows = products
    .filter((p) => p.active && ((!!p.categoryId && cats.has(p.categoryId)) || (stock?.get(p.id) ?? 0) !== 0 || alertOf.has(p.id)) && matches(q, p.name, p.sku))
    .filter((p) => !onlyMissing || alertOf.has(p.id))
    .map((p) => ({ p, qty: stock?.get(p.id) ?? 0 }))
    .sort((a, b) => (lk.category(a.p.categoryId) || '~').localeCompare(lk.category(b.p.categoryId) || '~', 'es') || a.p.name.localeCompare(b.p.name, 'es'));

  if (!outlets.length) return <div className="card"><EmptyState icon={<Store size={40} />} title="Todavía no hay puntos">Crealos en la pestaña Puntos.</EmptyState></div>;

  const count = async () => {
    const c = await run(() => startCount({ outletId: current }));
    if (c) navigate(`/conteo/${c.id}`);
  };

  return (
    <>
      <div className="toolbar">
        {!fixedId && (
          <Select aria-label="Punto" value={current} onChange={(e) => setOutletId(e.target.value)} style={{ maxWidth: 240 }}>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}{o.active ? '' : ' (desactivado)'}</option>)}
          </Select>
        )}
        <SearchInput value={q} onChange={setQ} placeholder="Buscar producto" label="Buscar producto en el punto" />
        {can('count.do') && rows.length > 0 && <button type="button" className="btn" onClick={count}><ClipboardCheck size={18} aria-hidden /> Contar este punto</button>}
        {canEdit && outlet && <button type="button" className={`btn ${editMins ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={editMins} onClick={() => setEditMins((v) => !v)}><SlidersHorizontal size={18} aria-hidden /> {editMins ? 'Listo con los mínimos' : 'Mínimos'}</button>}
        {canEdit && outlet && <button type="button" className="btn btn-ghost" onClick={() => setEditCats(true)}><Tags size={18} aria-hidden /> Familias del punto</button>}
      </div>
      {outlet && alerts.length > 0 && (
        <div className="alert alert-warn" role="status">
          <AlertTriangle size={18} aria-hidden />
          <div className="grow">
            <b>{alerts.length === 1 ? 'Falta 1 producto' : `Faltan ${alerts.length} productos`} en {outlet.name}</b>
            {outCount > 0 && <>: {outCount} sin stock</>}{alerts.length - outCount > 0 && <>{outCount > 0 ? ' y ' : ': '}{alerts.length - outCount} bajo el mínimo</>}.
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              <button type="button" className="btn btn-sm" aria-pressed={onlyMissing} onClick={() => setOnlyMissing((v) => !v)}>{onlyMissing ? 'Ver todo' : 'Ver solo lo que falta'}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void run(async () => {
                const text = `Faltan en ${outlet.name}:\n${alerts.map((a) => `- ${a.product.name}: hay ${fmtNumber(a.qty)}, mínimo ${fmtNumber(a.min)} (faltan ${fmtNumber(a.missing)} ${lk.unit(a.product.unitId)})`).join('\n')}`;
                await navigator.clipboard.writeText(text);
              }, 'Lista copiada: pegala en WhatsApp')}><Copy size={15} aria-hidden /> Copiar lista</button>
            </div>
          </div>
        </div>
      )}
      {outlet && !alerts.length && hasMins && <p className="small" style={{ margin: '0 0 8px' }}>Nada por debajo del mínimo en {outlet.name}, según el último conteo.</p>}
      {outlet && !hasMins && rows.length > 0 && (
        <p className="small muted" style={{ margin: '0 0 8px' }}>
          Para que avise lo que falta en {outlet.name}, cargá cuánto tiene que haber de cada producto{canEdit ? <> con <b>Mínimos</b></> : ' (lo hace un administrador)'}.
        </p>
      )}
      {editCats && outlet && (
        <OutletCategoriesModal name={outlet.name} categories={lk.categories} selected={[...cats]} onClose={() => setEditCats(false)}
          onSave={async (ids) => { if (await run(async () => { await setOutletCategories(outlet.id, ids); return true; }, 'Familias guardadas')) setEditCats(false); }} />
      )}
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        Familias que se cuentan acá: <b>{lk.categories.filter((c) => cats.has(c.id)).map((c) => c.name).join(', ') || 'ninguna'}</b>.
      </p>
      <p className="small muted" style={{ margin: '0 0 8px' }}>Stock según los remitos recibidos y los conteos del punto. Lo que se vende en el punto se descuenta en Maxirest, no acá: hacé conteos periódicos para mantenerlo al día.</p>
      <div className="card">
        {rows.length === 0 ? (
          <EmptyState icon={<Store size={40} />} title={q ? 'Sin resultados' : 'Este punto todavía no tiene productos'}>{q ? undefined : 'Elegí qué familias maneja en “Familias del punto”, o mandale mercadería por remito.'}</EmptyState>
        ) : (
          <div className="list">
            {rows.map(({ p, qty }, i) => (
              <Fragment key={p.id}>
              {(i === 0 || rows[i - 1].p.categoryId !== p.categoryId) && <div className="list-group-title">{lk.category(p.categoryId) || 'Sin familia'}</div>}
              <div className="list-item">
                <div className="grow">
                  <div className="list-title truncate">{p.name}</div>
                  <div className="list-sub">
                    {alertOf.get(p.id) && <span className={`badge ${alertOf.get(p.id)!.level === 'out' ? 'badge-error' : 'badge-warn'}`}>{alertOf.get(p.id)!.level === 'out' ? 'Sin stock' : 'Bajo'}</span>}
                    {outlet?.minStock?.[p.id] ? <> mín {fmtNumber(outlet.minStock[p.id])}{alertOf.get(p.id) ? ` · faltan ${fmtNumber(alertOf.get(p.id)!.missing)}` : ''}</> : null}
                    {p.sku && <>{outlet?.minStock?.[p.id] ? ' · ' : ''}Cód. {p.sku}</>}
                  </div>
                </div>
                {editMins && outlet && (
                  <NumberInput aria-label={`Mínimo de ${p.name} en ${outlet.name}`} placeholder="Mín." min={0} style={{ width: 80 }}
                    value={p.id in draft ? draft[p.id] : outlet.minStock?.[p.id]} onChange={(v) => setDraft((d) => ({ ...d, [p.id]: v }))} onBlur={(e) => saveMin(p.id, e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                )}
                <strong className={`num ${qty < 0 ? 'neg' : ''}`}>{fmtNumber(qty)} {lk.unit(p.unitId)}</strong>
              </div>
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Elegir qué familias maneja un punto (sus productos se ven y se cuentan ahí). */
function OutletCategoriesModal({ name, categories, selected, onClose, onSave }: { name: string; categories: { id: string; name: string }[]; selected: string[]; onClose: () => void; onSave: (ids: string[]) => void }) {
  const [ids, setIds] = useState(new Set(selected));
  const toggle = (id: string) => setIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Modal open title={`Familias de ${name}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => onSave([...ids])}>Guardar</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>Los productos de estas familias aparecen en el stock del punto (aunque estén en 0) y entran en sus conteos.</p>
      <div className="stack" style={{ gap: 6 }}>
        {categories.map((c) => (
          <label key={c.id} className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={ids.has(c.id)} onChange={() => toggle(c.id)} /> {c.name}
          </label>
        ))}
      </div>
    </Modal>
  );
}

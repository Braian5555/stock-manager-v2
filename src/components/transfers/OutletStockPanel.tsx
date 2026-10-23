import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, Store, Tags } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { db } from '../../database/db';
import { startCount } from '../../services/countService';
import { stockByOutlet } from '../../services/stockService';
import { outletCategoryIds, setOutletCategories } from '../../services/transferService';
import { Modal } from '../ui/Modal';
import { useLookups, useOutlets, useProducts } from '../../hooks/useData';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { EmptyState, SearchInput, Select } from '../ui';
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
  // Lo que maneja el punto (sus familias, aunque esté en 0) más lo que recibió por remito.
  const rows = products
    .filter((p) => p.active && ((!!p.categoryId && cats.has(p.categoryId)) || (stock?.get(p.id) ?? 0) !== 0) && matches(q, p.name, p.sku))
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
        {(can('catalog.manage') || can('admin')) && outlet && <button type="button" className="btn btn-ghost" onClick={() => setEditCats(true)}><Tags size={18} aria-hidden /> Familias del punto</button>}
      </div>
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
                  {p.sku && <div className="list-sub">Cód. {p.sku}</div>}
                </div>
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

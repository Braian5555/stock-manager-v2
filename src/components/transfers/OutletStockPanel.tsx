import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, Store } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { db } from '../../database/db';
import { startCount } from '../../services/countService';
import { stockByOutlet } from '../../services/stockService';
import { useLookups, useOutlets, useProducts } from '../../hooks/useData';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { EmptyState, SearchInput, Select } from '../ui';
import { fmtNumber, matches } from '../../utils/format';

export function OutletStockPanel() {
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
  const current = outletId || outlets.find((o) => o.active)?.id || '';
  const stock = byOutlet.get(current);
  const rows = products
    .filter((p) => stock?.has(p.id) && matches(q, p.name, p.sku))
    .map((p) => ({ p, qty: stock!.get(p.id)! }))
    .sort((a, b) => a.p.name.localeCompare(b.p.name, 'es'));

  if (!outlets.length) return <div className="card"><EmptyState icon={<Store size={40} />} title="Todavía no hay puntos">Crealos en la pestaña Puntos.</EmptyState></div>;

  const count = async () => {
    const c = await run(() => startCount({ outletId: current }));
    if (c) navigate(`/conteo/${c.id}`);
  };

  return (
    <>
      <div className="toolbar">
        <Select aria-label="Punto" value={current} onChange={(e) => setOutletId(e.target.value)} style={{ maxWidth: 240 }}>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}{o.active ? '' : ' (desactivado)'}</option>)}
        </Select>
        <SearchInput value={q} onChange={setQ} placeholder="Buscar producto" label="Buscar producto en el punto" />
        {can('count.do') && rows.length > 0 && <button type="button" className="btn" onClick={count}><ClipboardCheck size={18} aria-hidden /> Contar este punto</button>}
      </div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>Stock según los remitos recibidos y los conteos del punto. Lo que se vende en el punto se descuenta en Maxirest, no acá: hacé conteos periódicos para mantenerlo al día.</p>
      <div className="card">
        {rows.length === 0 ? (
          <EmptyState icon={<Store size={40} />} title={q ? 'Sin resultados' : 'Este punto todavía no recibió mercadería'} />
        ) : (
          <div className="list">
            {rows.map(({ p, qty }) => (
              <div key={p.id} className="list-item">
                <div className="grow">
                  <div className="list-title truncate">{p.name}</div>
                  <div className="list-sub">{lk.category(p.categoryId) || 'Sin familia'}</div>
                </div>
                <strong className={`num ${qty < 0 ? 'neg' : ''}`}>{fmtNumber(qty)} {lk.unit(p.unitId)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

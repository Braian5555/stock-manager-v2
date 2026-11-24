import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, Pencil, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { db } from '../../database/db';
import { EMPTY, useLookups, useProducts } from '../../hooks/useData';
import { useIncremental } from '../../hooks/useIncremental';
import type { Outlet, Product, StockMovement, StockStatus } from '../../models';
import { statusOf, stockByOutlet } from '../../services/stockService';
import { outletAlerts } from '../../services/transferService';
import { useSession } from '../../store/session';
import { useSettings } from '../../store/settings';
import { fmtNumber, matches, normalize } from '../../utils/format';
import { GroupBar, useProductGroups } from '../GroupBar';
import { EmptyState, SearchInput } from '../ui';

const CENTRAL = 'central';

interface Place { id: string; name: string; qty: number; low: boolean }
interface Row { p: Product; places: Place[]; low: Place[]; none: boolean }
const rowProduct = (r: Row) => r.p;

/**
 * Stock por lugar: cuánto hay de cada producto en el Depósito Central y en cada punto, por separado.
 * A propósito NO se suma un total: cada lugar es stock distinto (lo de la Confitería no está en la panadería),
 * y un número sumado se lee como si estuviera todo en un mismo lugar.
 */
export function TotalStockPanel({ outlets, onPlace }: { outlets: Outlet[]; onPlace: (id: string) => void }) {
  const products = useProducts();
  const lk = useLookups();
  const settings = useSettings();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'' | 'falta' | 'sin'>('');
  const outletMoves = (useLiveQuery(() => db.movements.filter((m) => !!m.outletId).toArray(), []) ?? EMPTY) as StockMovement[];
  const byOutlet = useMemo(() => stockByOutlet(outletMoves), [outletMoves]);

  const all = useMemo<Row[]>(() => {
    const lowAt = new Map(outlets.map((o) => [o.id, new Set(outletAlerts(o, byOutlet.get(o.id), products).map((a) => a.product.id))]));
    return products.filter((p) => p.active).map((p) => {
      const s = statusOf(p, settings);
      const dc: Place = { id: CENTRAL, name: 'Depósito', qty: p.stock, low: p.minStock > 0 && s !== 'normal' };
      const at: Place[] = outlets.map((o) => ({ id: o.id, name: o.name, qty: byOutlet.get(o.id)?.get(p.id) ?? 0, low: !!lowAt.get(o.id)?.has(p.id) }));
      // Se muestran los puntos que tienen algo o a los que les falta; el depósito siempre.
      const places = [dc, ...at.filter((x) => x.qty !== 0 || x.low)];
      return { p, places, low: [dc, ...at].filter((x) => x.low), none: [dc, ...at].every((x) => x.qty <= 0) };
    });
  }, [products, outlets, byOutlet, settings]);

  const counts = useMemo(() => ({ sin: all.filter((r) => r.none).length, falta: all.filter((r) => r.low.length > 0).length }), [all]);
  const rows = useMemo(() => {
    const list = all.filter((r) => matches(q, r.p.name, r.p.sku, r.p.barcode) && (only === 'sin' ? r.none : only === 'falta' ? r.low.length > 0 : true));
    return list.sort((a, b) => normalize(a.p.name).localeCompare(normalize(b.p.name), 'es'));
  }, [all, q, only]);
  const g = useProductGroups(rows, rowProduct, lk);
  const grouped = useMemo(() => (g.group ? rows.filter((r) => g.groupOf(r) === g.group) : rows), [rows, g]);
  const { visible: shown, sentinel } = useIncremental(grouped, `${q}|${only}|${g.mode}|${g.group}`);

  return (
    <>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar producto o código" label="Buscar en todos los lugares" />
      </div>
      {products.length > 0 && (
        <div className="stock-tiles" role="group" aria-label="Alertas de todos los lugares">
          {([
            ['falta', counts.falta, 'faltan en algún lugar'],
            ['sin', counts.sin, 'sin stock en ningún lugar'],
          ] as const).map(([key, n, label]) => (
            <button key={key} type="button" className={`stock-tile ${only === key ? 'on' : ''}`} aria-pressed={only === key} onClick={() => setOnly(only === key ? '' : key)}>
              <b className="num">{fmtNumber(n)}</b> {label}
            </button>
          ))}
        </div>
      )}
      <p className="small muted">Cuánto hay en cada lugar, por separado. Tocá un lugar para ver su detalle y registrar movimientos ahí.</p>

      <GroupBar mode={g.mode} groups={g.groups} group={g.group} total={rows.length} onMode={g.setMode} onGroup={g.setGroup} hideBar={!products.length}>
        {grouped.length === 0 ? (
          <div className="card">
            <EmptyState icon={<Boxes size={40} />} title={products.length ? 'Sin resultados' : 'Todavía no hay productos'}>
              {products.length ? 'Probá con otra búsqueda o quitá el filtro.' : undefined}
            </EmptyState>
          </div>
        ) : (
          <div className="product-cards">
            {shown.map(({ p, places, low, none }) => {
              const unit = lk.unit(p.unitId);
              const s: StockStatus = none ? 'sin_stock' : low.length ? 'bajo' : 'normal';
              return (
                <article key={p.id} className={`card pcard pcard-byplace s-${s}`} aria-label={p.name}>
                  <div className="pcard-top">
                    <span className="pcard-dot" aria-hidden />
                    <div className="grow">
                      <h3 className="truncate">{p.name}</h3>
                      <div className="pcard-meta">
                        {p.categoryId && <span className="row" style={{ gap: 4 }}><Tags size={13} aria-hidden />{lk.category(p.categoryId)}</span>}
                        {p.sku && <span className="pcard-extra">{p.sku}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="pcard-places" role="group" aria-label={`Stock de ${p.name} por lugar`}>
                    {places.map((x) => (
                      <button key={x.id} type="button" className={`pcard-place${x.low ? ' is-low' : ''}${x.qty <= 0 ? ' is-zero' : ''}`} onClick={() => onPlace(x.id)}
                        aria-label={`${x.name}: ${fmtNumber(x.qty)} ${unit}${x.low ? ', falta' : ''}`}>
                        <span>{x.name}</span> <b className="num">{fmtNumber(x.qty)}</b> <small>{unit}</small>
                      </button>
                    ))}
                  </div>
                  {(none || low.length > 0) && (
                    <div className="row pcard-status">
                      {none ? <span className="badge badge-sin_stock"><span className="dot" aria-hidden />Sin stock en ningún lugar</span>
                        : <span className="badge badge-bajo"><span className="dot" aria-hidden />Falta en {low.map((x) => x.name).join(', ')}</span>}
                    </div>
                  )}
                  {can('catalog.manage') && (
                    <div className="row pcard-actions">
                      <Link className="btn btn-sm btn-ghost" to={`/productos?editar=${p.id}`} aria-label={`Editar ${p.name}`}><Pencil size={16} aria-hidden /><span className="btn-label">Editar</span></Link>
                    </div>
                  )}
                </article>
              );
            })}
            {sentinel}
          </div>
        )}
      </GroupBar>
    </>
  );
}

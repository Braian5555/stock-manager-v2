import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, Hourglass, Pencil, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { db } from '../../database/db';
import { EMPTY, useLookups, useProducts } from '../../hooks/useData';
import { useIncremental } from '../../hooks/useIncremental';
import type { Outlet, Product, StockMovement, StockStatus } from '../../models';
import { daysLabel, usageByProduct } from '../../services/consumptionService';
import { statusOf, stockByOutlet } from '../../services/stockService';
import { outletAlerts, outletCategoryIds } from '../../services/transferService';
import { useSession } from '../../store/session';
import { useSettings } from '../../store/settings';
import { fmtNumber, matches, normalize } from '../../utils/format';
import { GroupBar, useProductGroups } from '../GroupBar';
import { EmptyState, SearchInput, StatusBadge } from '../ui';

/** Se marca "se termina pronto" si alcanza para esta cantidad de días o menos (igual que en el depósito). */
const SOON_DAYS = 3;
const CENTRAL = 'central';

interface Place { id: string; name: string; qty: number; low: boolean }
interface Row { p: Product; total: number; places: Place[]; low: Place[] }
const rowProduct = (r: Row) => r.p;

/**
 * Stock total: lo que hay de cada producto sumando el Depósito Central y todos los puntos.
 * Cada tarjeta muestra cuánto hay en cada lugar; tocar un lugar abre su stock.
 */
export function TotalStockPanel({ outlets, onPlace }: { outlets: Outlet[]; onPlace: (id: string) => void }) {
  const products = useProducts();
  const lk = useLookups();
  const settings = useSettings();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'' | 'falta' | 'sin'>('');
  // Movimientos de los últimos 30 días (para el consumo) y los de los puntos (para su stock).
  const since = useMemo(() => new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 13), []);
  const recent = (useLiveQuery(() => db.movements.where('createdAt').aboveOrEqual(since).toArray(), [since]) ?? EMPTY) as StockMovement[];
  const outletMoves = (useLiveQuery(() => db.movements.filter((m) => !!m.outletId).toArray(), []) ?? EMPTY) as StockMovement[];
  const byOutlet = useMemo(() => stockByOutlet(outletMoves), [outletMoves]);

  const all = useMemo<Row[]>(() => {
    const lowAt = new Map(outlets.map((o) => [o.id, new Set(outletAlerts(o, byOutlet.get(o.id), products).map((a) => a.product.id))]));
    const famAt = new Map(outlets.map((o) => [o.id, new Set(outletCategoryIds(o, lk.categories))]));
    return products.filter((p) => p.active).map((p) => {
      const s = statusOf(p, settings);
      const places: Place[] = [{ id: CENTRAL, name: 'Depósito', qty: p.stock, low: p.minStock > 0 && s !== 'normal' }];
      for (const o of outlets) {
        const qty = byOutlet.get(o.id)?.get(p.id) ?? 0;
        const low = !!lowAt.get(o.id)?.has(p.id);
        // Un punto aparece si tiene algo, si le falta, o si maneja la familia del producto.
        if (qty !== 0 || low || (p.categoryId && famAt.get(o.id)?.has(p.categoryId))) places.push({ id: o.id, name: o.name, qty, low });
      }
      const total = Math.round(places.reduce((a, x) => a + x.qty, 0) * 1000) / 1000;
      return { p, total, places, low: places.filter((x) => x.low) };
    });
  }, [products, outlets, byOutlet, settings, lk.categories]);

  // Consumo de todos los lugares juntos. Los remitos sólo mueven mercadería de un lugar a otro: no son consumo.
  const usage = useMemo(
    () => usageByProduct(all.map(({ p, total }) => ({ id: p.id, stock: total, createdAt: p.createdAt, active: p.active })), recent.filter((m) => m.origin !== 'remito'), 30),
    [all, recent],
  );

  const counts = useMemo(() => ({ sin: all.filter((r) => r.total <= 0).length, falta: all.filter((r) => r.low.length > 0).length }), [all]);
  const rows = useMemo(() => {
    const list = all.filter((r) => matches(q, r.p.name, r.p.sku, r.p.barcode) && (only === 'sin' ? r.total <= 0 : only === 'falta' ? r.low.length > 0 : true));
    return list.sort((a, b) => normalize(a.p.name).localeCompare(normalize(b.p.name), 'es'));
  }, [all, q, only]);
  const g = useProductGroups(rows, rowProduct, lk);
  const grouped = useMemo(() => (g.group ? rows.filter((r) => g.groupOf(r) === g.group) : rows), [rows, g]);
  const { visible: shown, sentinel } = useIncremental(grouped, `${q}|${only}|${g.mode}|${g.group}`);

  return (
    <>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar producto o código" label="Buscar en el stock total" />
      </div>
      {products.length > 0 && (
        <div className="stock-tiles" role="group" aria-label="Alertas del stock total">
          {([
            ['falta', counts.falta, 'faltan en algún lugar'],
            ['sin', counts.sin, 'sin stock en ningún lado'],
          ] as const).map(([key, n, label]) => (
            <button key={key} type="button" className={`stock-tile ${only === key ? 'on' : ''}`} aria-pressed={only === key} onClick={() => setOnly(only === key ? '' : key)}>
              <b className="num">{fmtNumber(n)}</b> {label}
            </button>
          ))}
        </div>
      )}
      <p className="small muted">Suma del Depósito Central y {outlets.length === 1 ? `de ${outlets[0].name}` : `de los ${outlets.length} puntos`}. Tocá un lugar para ver su detalle y registrar movimientos ahí.</p>

      <GroupBar mode={g.mode} groups={g.groups} group={g.group} total={rows.length} onMode={g.setMode} onGroup={g.setGroup} hideBar={!products.length}>
        {grouped.length === 0 ? (
          <div className="card">
            <EmptyState icon={<Boxes size={40} />} title={products.length ? 'Sin resultados' : 'Todavía no hay productos'}>
              {products.length ? 'Probá con otra búsqueda o quitá el filtro.' : undefined}
            </EmptyState>
          </div>
        ) : (
          <div className="product-cards">
            {shown.map(({ p, total, places, low }) => {
              const unit = lk.unit(p.unitId);
              const s: StockStatus = total <= 0 ? 'sin_stock' : low.length ? 'bajo' : 'normal';
              const u = usage.get(p.id);
              const soon = !!u?.perDay && total > 0 && (u.daysLeft ?? Infinity) <= SOON_DAYS;
              return (
                <article key={p.id} className={`card pcard s-${s}${total < 0 ? ' is-neg' : ''}`} aria-label={p.name}>
                  <div className="pcard-top">
                    <span className="pcard-dot" aria-hidden />
                    <div className="grow">
                      <h3 className="truncate">{p.name}</h3>
                      <div className="pcard-meta">
                        {p.categoryId && <span className="row" style={{ gap: 4 }}><Tags size={13} aria-hidden />{lk.category(p.categoryId)}</span>}
                        {p.sku && <span className="pcard-extra">{p.sku}</span>}
                      </div>
                    </div>
                    <div className="pcard-qty"><strong>{fmtNumber(total)}</strong><span>{unit} en total</span></div>
                  </div>
                  <div className="row between pcard-status">
                    {total < 0 ? <span className="badge badge-sin_stock"><span className="dot" aria-hidden />En negativo</span>
                      : s === 'bajo' ? <span className="badge badge-bajo"><span className="dot" aria-hidden />Falta en {low.map((x) => x.name).join(', ')}</span>
                      : <StatusBadge status={s} />}
                  </div>
                  <div className="pcard-places" role="group" aria-label={`Stock de ${p.name} por lugar`}>
                    {places.map((x) => (
                      <button key={x.id} type="button" className={`pcard-place${x.low ? ' is-low' : ''}${x.qty <= 0 ? ' is-zero' : ''}`} onClick={() => onPlace(x.id)}
                        aria-label={`${x.name}: ${fmtNumber(x.qty)} ${unit}${x.low ? ', falta' : ''}`}>
                        <span>{x.name}</span> <b className="num">{fmtNumber(x.qty)}</b>
                      </button>
                    ))}
                  </div>
                  {u?.perDay ? (
                    <div className={`small pcard-usage${soon ? ' is-soon' : ''}`}>
                      <Hourglass size={13} aria-hidden /> Entre todos usan {fmtNumber(u.perDay)} {unit}/día · alcanza {daysLabel(u.daysLeft)}
                    </div>
                  ) : null}
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

import { useSession } from '../store/session';
import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, MapPin, Plus, SlidersHorizontal, Tags, Truck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { db } from '../database/db';
import { useLookups, useProducts, EMPTY } from '../hooks/useData';
import type { Product, StockStatus } from '../models';
import { STATUS_LABEL, statusOf } from '../services/stockService';
import { menuLabel } from '../services/settingsService';
import { useSettings } from '../store/settings';
import { EmptyState, PageHeader, SearchInput, Select, StatusBadge } from '../components/ui';
import { MovementModal } from '../components/MovementModal';
import { fmtNumber, matches, normalize } from '../utils/format';
import { useIncremental } from '../hooks/useIncremental';

type SortKey = 'name' | 'qty' | 'category' | 'location';

export function StockPage() {
  const settings = useSettings();
  const { can } = useSession();
  const products = useProducts();
  const lk = useLookups();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [moving, setMoving] = useState<Product | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const refs = useLiveQuery(() => db.externalReferences.where({ system: 'maxirest', entityType: 'product' }).toArray(), []) ?? EMPTY;
  const extStock = useMemo(() => new Map(refs.map((r) => [r.externalId, r.stock])), [refs]);

  const f = { familia: params.get('familia') ?? '', proveedor: params.get('proveedor') ?? '', ubicacion: params.get('ubicacion') ?? '', estado: params.get('estado') ?? '' };
  const setF = (k: keyof typeof f, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const activeFilters = Object.values(f).filter(Boolean).length;

  const rows = useMemo(() => {
    const list = products
      .filter((p) => p.active)
      .map((p) => ({ p, s: statusOf(p, settings) }))
      .filter(({ p, s }) =>
        matches(q, p.name, p.sku) &&
        (!f.familia || p.categoryId === f.familia) &&
        (!f.ubicacion || p.locationId === f.ubicacion) &&
        (!f.proveedor || p.supplierId === f.proveedor || p.alternativeSupplierIds.includes(f.proveedor)) &&
        (!f.estado || (f.estado === 'bajo' ? s === 'bajo' || s === 'critico' : s === f.estado)),
      );
    const by = (a: string, b: string) => normalize(a).localeCompare(normalize(b), 'es');
    list.sort((a, b) =>
      sort === 'qty' ? a.p.stock - b.p.stock
        : sort === 'category' ? by(lk.category(a.p.categoryId), lk.category(b.p.categoryId)) || by(a.p.name, b.p.name)
        : sort === 'location' ? by(lk.location(a.p.locationId), lk.location(b.p.locationId)) || by(a.p.name, b.p.name)
        : by(a.p.name, b.p.name),
    );
    return list;
  }, [products, settings, q, f.familia, f.ubicacion, f.proveedor, f.estado, sort, lk]);
  const { visible: shown, sentinel } = useIncremental(rows, `${q}|${f.familia}|${f.ubicacion}|${f.proveedor}|${f.estado}|${sort}`);

  return (
    <>
      <PageHeader
        title={menuLabel(settings, 'stock')}
        subtitle={`${rows.length} productos`}
        actions={can('catalog.manage') ? <Link to="/productos?nuevo=1" className="btn btn-primary"><Plus size={18} aria-hidden /> Producto</Link> : undefined}
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar producto o código" label="Buscar productos" />
        <button type="button" className="btn filters-toggle" aria-expanded={showFilters} aria-controls="stock-filters" onClick={() => setShowFilters((v) => !v)}>
          <SlidersHorizontal size={18} aria-hidden /> Filtros{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>
      {(f.familia || f.ubicacion || f.proveedor || f.estado) && (
        <div className="filter-chips" aria-label="Filtros activos">
          {f.familia && <button type="button" className="filter-chip" onClick={() => setF('familia', '')} aria-label={`Quitar filtro familia ${lk.category(f.familia)}`}>Familia: <b>{lk.category(f.familia) || '—'}</b> <X size={14} aria-hidden /></button>}
          {f.ubicacion && <button type="button" className="filter-chip" onClick={() => setF('ubicacion', '')} aria-label={`Quitar filtro ubicación ${lk.location(f.ubicacion)}`}>Ubicación: <b>{lk.location(f.ubicacion) || '—'}</b> <X size={14} aria-hidden /></button>}
          {f.proveedor && <button type="button" className="filter-chip" onClick={() => setF('proveedor', '')} aria-label={`Quitar filtro proveedor ${lk.supplier(f.proveedor)}`}>Proveedor: <b>{lk.supplier(f.proveedor) || '—'}</b> <X size={14} aria-hidden /></button>}
          {f.estado && <button type="button" className="filter-chip" onClick={() => setF('estado', '')} aria-label="Quitar filtro estado">Estado: <b>{f.estado === 'bajo' ? 'Bajo y crítico' : STATUS_LABEL[f.estado as StockStatus]}</b> <X size={14} aria-hidden /></button>}
        </div>
      )}
      <div id="stock-filters" className={`filters ${showFilters ? '' : 'collapsed'}`}>
        <Select aria-label="Filtrar por familia" value={f.familia} onChange={(e) => setF('familia', e.target.value)}>
          <option value="">Todas las familias</option>
          {lk.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Filtrar por proveedor" value={f.proveedor} onChange={(e) => setF('proveedor', e.target.value)}>
          <option value="">Todos los proveedores</option>
          {lk.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select aria-label="Filtrar por ubicación" value={f.ubicacion} onChange={(e) => setF('ubicacion', e.target.value)}>
          <option value="">Todas las ubicaciones</option>
          {lk.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select aria-label="Filtrar por estado" value={f.estado} onChange={(e) => setF('estado', e.target.value)}>
          <option value="">Todos los estados</option>
          {(['normal', 'bajo', 'critico', 'sin_stock'] as StockStatus[]).map((s) => <option key={s} value={s}>{s === 'bajo' ? 'Bajo y crítico' : STATUS_LABEL[s]}</option>)}
        </Select>
        <Select aria-label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="name">Ordenar: nombre</option>
          <option value="qty">Ordenar: cantidad</option>
          <option value="category">Ordenar: familia</option>
          <option value="location">Ordenar: ubicación</option>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Boxes size={40} />} title={products.length ? 'Sin resultados' : 'Todavía no hay productos'}
            action={!products.length && can('catalog.manage') && <Link to="/productos?nuevo=1" className="btn btn-primary">Crear producto</Link>}>
            {products.length ? 'Probá con otra búsqueda o quitá filtros.' : 'Creá tu primer producto para empezar a controlar el stock.'}
          </EmptyState>
        </div>
      ) : (
        <div className="product-cards">
          {shown.map(({ p, s }) => {
            const unit = lk.unit(p.unitId);
            const pct = p.maxStock > 0 ? Math.min(100, (Math.max(0, p.stock) / p.maxStock) * 100) : undefined;
            const ext = p.externalSystems?.maxirest ? extStock.get(p.externalSystems.maxirest.id) : undefined;
            return (
              <article key={p.id} className={`card pcard s-${s}`} aria-label={p.name}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <h3 className="truncate">{p.name}</h3>
                    {p.sku && <div className="small muted">{p.sku}</div>}
                  </div>
                  <StatusBadge status={s} />
                </div>
                <div className="pcard-meta">
                  {p.categoryId && <span className="row" style={{ gap: 4 }}><Tags size={13} aria-hidden />{lk.category(p.categoryId)}</span>}
                  {p.locationId && <span className="row" style={{ gap: 4 }}><MapPin size={13} aria-hidden />{lk.location(p.locationId)}</span>}
                  {p.supplierId && <span className="row" style={{ gap: 4 }}><Truck size={13} aria-hidden />{lk.supplier(p.supplierId)}</span>}
                </div>
                <div className="row between">
                  <div className="pcard-qty"><strong>{fmtNumber(p.stock)}</strong><span className="muted">{unit}</span></div>
                  <div className="small muted num">mín {fmtNumber(p.minStock)} · máx {fmtNumber(p.maxStock)}</div>
                </div>
                {pct !== undefined && <div className="bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>}
                {ext !== undefined && (
                  <div className="small muted">Stock Maxirest: <strong className="num">{fmtNumber(ext)}</strong> · diferencia <strong className="num">{fmtNumber(p.stock - ext)}</strong></div>
                )}
                <div className="row">
                  {can('stock.move') && <button type="button" className="btn btn-sm grow" onClick={() => setMoving(p)}>Registrar movimiento</button>}
                  {can('catalog.manage') && <Link className="btn btn-sm btn-ghost" to={`/productos?editar=${p.id}`}>Editar</Link>}
                </div>
              </article>
            );
          })}
          {sentinel}
        </div>
      )}
      {moving && <MovementModal product={products.find((x) => x.id === moving.id) ?? null} onClose={() => setMoving(null)} />}
    </>
  );
}

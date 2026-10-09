import { Copy, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useLookups, useProducts } from '../hooks/useData';
import { deleteProduct, duplicateProduct } from '../services/productService';
import { menuLabel } from '../services/settingsService';
import { statusOf } from '../services/stockService';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Badge, EmptyState, PageHeader, SearchInput, StatusBadge } from '../components/ui';
import { ProductForm } from '../components/ProductForm';
import { fmtNumber, matches } from '../utils/format';
import { useIncremental } from '../hooks/useIncremental';
import { GroupBar, useProductGroups } from '../components/GroupBar';
import type { Product } from '../models';

const self = (p: Product) => p;

export function ProductsPage() {
  const settings = useSettings();
  const products = useProducts();
  const lk = useLookups();
  const { run, confirm, notify } = useFeedback();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const editingId = params.get('editar');
  const creating = params.get('nuevo') === '1';
  const editing = editingId ? products.find((p) => p.id === editingId) : undefined;

  // Cerrar el formulario conserva la agrupación elegida.
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('editar');
    next.delete('nuevo');
    setParams(next, { replace: true });
  };
  const open = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next);
  };
  const list = useMemo(
    () => products.filter((p) => matches(q, p.name, p.sku, lk.category(p.categoryId), lk.supplier(p.supplierId))).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [products, q, lk],
  );
  const g = useProductGroups(list, self, lk);
  const { visible, sentinel } = useIncremental(g.shown, `${q}|${g.mode}|${g.group}`);

  const remove = async (id: string, name: string) => {
    const ok = await confirm({ title: 'Eliminar producto', message: <p>¿Eliminar <strong>{name}</strong>? El historial de movimientos se conserva.</p>, confirmLabel: 'Eliminar', danger: true });
    if (!ok) return;
    const undo = await run(() => deleteProduct(id));
    if (undo) notify(`"${name}" eliminado`, { undo: undo.restore });
  };

  return (
    <>
      <PageHeader
        title={menuLabel(settings, 'products')}
        subtitle={`${products.length} productos`}
        actions={<button type="button" className="btn btn-primary" onClick={() => open({ nuevo: '1' })}><Plus size={18} aria-hidden /> Nuevo producto</button>}
      />
      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Buscar producto, código o familia" /></div>
      {products.length > 0 && <GroupBar mode={g.mode} groups={g.groups} group={g.group} total={list.length} onMode={g.setMode} onGroup={g.setGroup} />}
      <div className="card">
        {list.length === 0 ? (
          <EmptyState icon={<Package size={40} />} title={products.length ? 'Sin resultados' : 'Sin productos'}>
            {products.length ? 'Probá con otra búsqueda.' : 'Creá tu primer producto con el botón “Nuevo producto”.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Producto</th><th>Código</th><th>Familia</th><th>Ubicación</th><th>Proveedor</th><th className="num">Stock</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr>
              </thead>
              <tbody>
                {visible.map((p, i) => (
                  <Fragment key={p.id}>
                  {(i === 0 || g.groupOf(visible[i - 1]) !== g.groupOf(p)) && (
                    <tr className="group-row"><th colSpan={8} scope="rowgroup">{g.labelOf(g.groupOf(p))} <span className="muted num">{g.groups.find((x) => x.id === g.groupOf(p))?.count}</span></th></tr>
                  )}
                  <tr>
                    <td className="cell-title">
                      {p.name} {!p.active && <Badge>Inactivo</Badge>} {p.externalSystems?.maxirest && <Badge tone="info">Maxirest</Badge>}
                      <span className="cell-sub only-mobile">{[p.sku, lk.category(p.categoryId), lk.location(p.locationId), lk.supplier(p.supplierId)].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td data-label="Código" className="hide-mobile">{p.sku || '—'}</td>
                    <td data-label="Familia" className="hide-mobile">{lk.category(p.categoryId) || '—'}</td>
                    <td data-label="Ubicación" className="hide-mobile">{lk.location(p.locationId) || '—'}</td>
                    <td data-label="Proveedor" className="hide-mobile">{lk.supplier(p.supplierId) || '—'}</td>
                    <td data-label="Stock" className="num">{fmtNumber(p.stock)} {lk.unit(p.unitId)}</td>
                    <td data-label="Estado"><StatusBadge status={statusOf(p, settings)} /></td>
                    <td data-label="Acciones">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Editar ${p.name}`} onClick={() => open({ editar: p.id })}><Pencil size={16} /></button>
                        <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Duplicar ${p.name}`} onClick={() => run(() => duplicateProduct(p.id), 'Producto duplicado')}><Copy size={16} /></button>
                        <button type="button" className="btn btn-sm btn-ghost icon-btn btn-danger" aria-label={`Eliminar ${p.name}`} onClick={() => remove(p.id, p.name)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
            {sentinel}
          </div>
        )}
      </div>
      <ProductForm open={creating || !!editing} product={editing} onClose={close} />
    </>
  );
}

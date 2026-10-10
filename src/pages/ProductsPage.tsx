import { CheckSquare, Copy, Package, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useLookups, useProducts } from '../hooks/useData';
import { deleteProduct, duplicateProduct } from '../services/productService';
import { menuLabel } from '../services/settingsService';
import { statusOf } from '../services/stockService';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { ScanButton } from '../components/scanner/ScanButton';
import { LabelsModal } from '../components/scanner/LabelsModal';
import { Badge, EmptyState, PageHeader, SearchInput, StatusBadge } from '../components/ui';
import { ProductForm } from '../components/ProductForm';
import { BulkEditModal } from '../components/BulkEditModal';
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
  const [labels, setLabels] = useState(false);
  // Selección para cambios en lote. "elegir=1" en la URL la abre (p. ej. desde el aviso de productos sin mínimo).
  const [selecting, setSelecting] = useState(params.get('elegir') === '1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const noMin = params.get('sinMinimo') === '1';
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
    () => products
      .filter((p) => (!noMin || (p.active && p.minStock <= 0)) && matches(q, p.name, p.sku, p.barcode, lk.category(p.categoryId), lk.supplier(p.supplierId)))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [products, q, lk, noMin],
  );
  const g = useProductGroups(list, self, lk);
  const { visible, sentinel } = useIncremental(g.shown, `${q}|${g.mode}|${g.group}`);

  const allShown = g.shown.length > 0 && g.shown.every((p) => selected.has(p.id));
  const toggle = (id: string, on: boolean) => setSelected((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n; });
  const toggleAll = (on: boolean) => setSelected((cur) => { const n = new Set(cur); for (const p of g.shown) { if (on) n.add(p.id); else n.delete(p.id); } return n; });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  const chosen = products.filter((p) => selected.has(p.id));
  const clearNoMin = () => { const next = new URLSearchParams(params); next.delete('sinMinimo'); setParams(next, { replace: true }); };

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
        actions={<><ScanButton /><button type="button" className="btn" aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}><CheckSquare size={18} aria-hidden /> {selecting ? 'Terminar' : 'Elegir varios'}</button><button type="button" className="btn" onClick={() => setLabels(true)}><Tag size={18} aria-hidden /> Etiquetas</button><button type="button" className="btn btn-primary" onClick={() => open({ nuevo: '1' })}><Plus size={18} aria-hidden /> Nuevo producto</button></>}
      />
      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Buscar producto, código o familia" /></div>
      {noMin && (
        <div className="filter-chips">
          <button type="button" className="filter-chip" onClick={clearNoMin} aria-label="Quitar filtro sin mínimo">Sin mínimo cargado <X size={14} aria-hidden /></button>
          <span className="small muted">Estos productos no avisan cuando se están acabando. Elegilos y cargales el mínimo en lote.</span>
        </div>
      )}
      <GroupBar mode={g.mode} groups={g.groups} group={g.group} total={list.length} onMode={g.setMode} onGroup={g.setGroup} hideBar={!products.length}>
      <div className="card">
        {list.length === 0 ? (
          <EmptyState icon={<Package size={40} />} title={products.length ? 'Sin resultados' : 'Sin productos'}>
            {products.length ? 'Probá con otra búsqueda.' : 'Creá tu primer producto con el botón “Nuevo producto”.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>{selecting && <th className="col-check"><input type="checkbox" checked={allShown} onChange={(e) => toggleAll(e.target.checked)} aria-label={`Elegir los ${g.shown.length} productos de la lista`} /></th>}<th>Producto</th><th>Código</th>{g.mode !== 'familia' && <th>Familia</th>}{g.mode !== 'ubicacion' && <th>Ubicación</th>}<th>Proveedor</th><th className="num">Stock</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr>
              </thead>
              <tbody>
                {visible.map((p, i) => (
                  <Fragment key={p.id}>
                  {(i === 0 || g.groupOf(visible[i - 1]) !== g.groupOf(p)) && (
                    <tr className="group-row"><th colSpan={(selecting ? 9 : 8) - (g.mode === 'unidad' ? 0 : 1)} scope="rowgroup">{g.labelOf(g.groupOf(p))} <span className="muted num">{g.groups.find((x) => x.id === g.groupOf(p))?.count}</span></th></tr>
                  )}
                  <tr className={selected.has(p.id) ? 'row-selected' : undefined}>
                    {selecting && <td className="col-check"><input type="checkbox" checked={selected.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} aria-label={`Elegir ${p.name}`} /></td>}
                    <td className="cell-title">
                      {p.name} {!p.active && <Badge>Inactivo</Badge>} {p.externalSystems?.maxirest && <Badge tone="info">Maxirest</Badge>}
                      <span className="cell-sub only-mobile">{[p.sku, lk.category(p.categoryId), lk.location(p.locationId), lk.supplier(p.supplierId)].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td data-label="Código" className="hide-mobile nowrap">{p.sku || '—'}</td>
                    {g.mode !== 'familia' && <td data-label="Familia" className="hide-mobile">{lk.category(p.categoryId) || '—'}</td>}
                    {g.mode !== 'ubicacion' && <td data-label="Ubicación" className="hide-mobile">{lk.location(p.locationId) || '—'}</td>}
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
      </GroupBar>
      <ProductForm open={creating || !!editing} product={editing} onClose={close} />
      {selecting && (
        <div className="bulk-bar" role="region" aria-label="Productos elegidos">
          <span className="grow" style={{ whiteSpace: 'nowrap' }}><b className="num">{selected.size}</b> {selected.size === 1 ? 'elegido' : 'elegidos'}</span>
          {!allShown && g.shown.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => toggleAll(true)}>Elegir los {g.shown.length}</button>}
          {selected.size > 0 && <button type="button" className="btn btn-sm btn-ghost bulk-none" onClick={() => setSelected(new Set())}>Ninguno</button>}
          <button type="button" className="btn btn-primary" disabled={!selected.size} onClick={() => setBulk(true)}>Cambiar…</button>
        </div>
      )}
      <BulkEditModal open={bulk} products={chosen} onClose={() => setBulk(false)} onDone={() => { setBulk(false); setSelected(new Set()); }} />
      <LabelsModal open={labels} products={g.shown} scope={g.group ? 'del grupo elegido' : q ? 'de la búsqueda' : 'de la lista'} onClose={() => setLabels(false)} />
    </>
  );
}

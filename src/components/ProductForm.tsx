import { useEffect, useState, useRef } from 'react';
import type { Product } from '../models';
import { emptyProduct, saveProduct } from '../services/productService';
import type { Draft } from '../services/entityService';
import { unlink } from '../integrations/core/linking';
import { useLookups } from '../hooks/useData';
import { useFeedback } from '../store/feedback';
import { Modal } from './ui/Modal';
import { Field, Input, NumberInput, Select, Textarea } from './ui';

export function ProductForm({ product, open, onClose }: { product?: Product; open: boolean; onClose: (saved?: Product) => void }) {
  const lk = useLookups();
  const { run, notify } = useFeedback();
  const [d, setD] = useState<Draft<Product>>(emptyProduct());
  const [initial, setInitial] = useState<number | undefined>();
  const isNew = !product;

  // Se inicializa al abrir (o al cambiar de producto), no cada vez que cambia algún dato:
  // si no, un movimiento sincronizado desde otro dispositivo borraría lo que se está escribiendo.
  const productRef = useRef(product);
  productRef.current = product;
  useEffect(() => {
    if (open) {
      setD(productRef.current ? { ...productRef.current } : emptyProduct());
      setInitial(undefined);
    }
  }, [open, product?.id]);

  const set = <K extends keyof Draft<Product>>(k: K, v: Draft<Product>[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    if (!d.name.trim()) return notify('Ingresá el nombre del producto.', { tone: 'error' });
    if (d.maxStock > 0 && d.maxStock < d.minStock) return notify('El stock máximo no puede ser menor que el mínimo.', { tone: 'error' });
    const saved = await run(() => saveProduct(d, initial ?? 0), isNew ? 'Producto creado' : 'Cambios guardados');
    if (saved) onClose(saved);
  };

  const alt = new Set(d.alternativeSupplierIds);
  const link = product?.externalSystems?.maxirest;

  return (
    <Modal
      open={open}
      wide
      title={isNew ? 'Nuevo producto' : 'Editar producto'}
      onClose={() => onClose()}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onClose()}>Cancelar</button>
          <button type="submit" form="product-form" className="btn btn-primary">Guardar</button>
        </>
      }
    >
      <form id="product-form" className="form-grid cols-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Nombre" className="span-all">
          <Input value={d.name} onChange={(e) => set('name', e.target.value)} required data-autofocus placeholder="Ej.: Hielo 10 kg" />
        </Field>
        <Field label="Código / SKU" hint="opcional">
          <Input value={d.sku ?? ''} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label="Familia">
          <Select value={d.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || undefined)}>
            <option value="">Sin familia</option>
            {lk.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Unidad de stock">
          <Select value={d.unitId ?? ''} onChange={(e) => set('unitId', e.target.value || undefined)}>
            <option value="">Sin unidad</option>
            {lk.units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
          </Select>
        </Field>
        <Field label="Ubicación">
          <Select value={d.locationId ?? ''} onChange={(e) => set('locationId', e.target.value || undefined)}>
            <option value="">Sin ubicación</option>
            {lk.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Unidad de compra" hint="opcional">
          <Select value={d.purchaseUnitId ?? ''} onChange={(e) => set('purchaseUnitId', e.target.value || undefined)}>
            <option value="">Igual a la unidad de stock</option>
            {lk.units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
          </Select>
        </Field>
        <Field label="Equivalencia" hint={`1 ${lk.unit(d.purchaseUnitId) || 'unidad de compra'} = ? ${lk.unit(d.unitId) || 'unidades de stock'}`}>
          <NumberInput value={d.purchaseFactor} onChange={(v) => set('purchaseFactor', v ?? 1)} min={0} />
        </Field>
        <Field label="Proveedor principal">
          <Select value={d.supplierId ?? ''} onChange={(e) => set('supplierId', e.target.value || undefined)}>
            <option value="">Sin proveedor</option>
            {lk.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Stock mínimo">
          <NumberInput value={d.minStock} onChange={(v) => set('minStock', v ?? 0)} min={0} />
        </Field>
        <Field label="Stock máximo">
          <NumberInput value={d.maxStock} onChange={(v) => set('maxStock', v ?? 0)} min={0} />
        </Field>
        {isNew && (
          <Field label="Stock inicial" hint="se registra como ingreso">
            <NumberInput value={initial} onChange={setInitial} min={0} />
          </Field>
        )}
        {lk.suppliers.length > 1 && (
          <fieldset className="span-all" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small" style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Proveedores alternativos</legend>
            <div className="chip-list">
              {lk.suppliers.filter((s) => s.id !== d.supplierId).map((s) => (
                <label key={s.id} className="check badge" style={{ minHeight: 36, padding: '4px 10px' }}>
                  <input
                    type="checkbox"
                    checked={alt.has(s.id)}
                    onChange={(e) => set('alternativeSupplierIds', e.target.checked ? [...alt, s.id] : [...alt].filter((x) => x !== s.id))}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Observaciones" className="span-all">
          <Textarea value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <label className="check span-all">
          <input type="checkbox" checked={d.active} onChange={(e) => set('active', e.target.checked)} /> Producto activo
        </label>
        {!isNew && <p className="small muted span-all">El stock se modifica desde “Registrar movimiento”, conteos o pedidos, para que siempre quede en el historial.</p>}
        {link && product && (
          <div className="alert alert-info span-all">
            <span className="grow">Vinculado con Maxirest · insumo {link.code ?? link.id}</span>
            <button type="button" className="btn btn-sm" onClick={() => run(() => unlink('product', product.id), 'Vínculo eliminado').then(() => onClose())}>Desvincular</button>
          </div>
        )}
      </form>
    </Modal>
  );
}

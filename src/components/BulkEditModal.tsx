import { useEffect, useState } from 'react';
import { useLookups } from '../hooks/useData';
import type { Product } from '../models';
import { bulkUpdateProducts, type BulkPatch } from '../services/productService';
import { useFeedback } from '../store/feedback';
import { Field, NumberInput, Select } from './ui';
import { Modal } from './ui/Modal';

type What = 'category' | 'location' | 'supplier' | 'unit' | 'minmax' | 'active';
const WHAT: { value: What; label: string }[] = [
  { value: 'category', label: 'Familia' },
  { value: 'location', label: 'Ubicación' },
  { value: 'supplier', label: 'Proveedor principal' },
  { value: 'unit', label: 'Unidad de stock' },
  { value: 'minmax', label: 'Mínimo y máximo' },
  { value: 'active', label: 'Activo / inactivo' },
];

/**
 * Cambiar un dato a varios productos a la vez. Muestra exactamente qué va a pasar antes de
 * aplicar, nunca toca el stock y deja deshacer.
 */
export function BulkEditModal({ open, products, onClose, onDone }: { open: boolean; products: Product[]; onClose: () => void; onDone: () => void }) {
  const lk = useLookups();
  const { run, notify } = useFeedback();
  const [what, setWhat] = useState<What>('category');
  const [value, setValue] = useState('');
  const [min, setMin] = useState<number | undefined>();
  const [max, setMax] = useState<number | undefined>();

  useEffect(() => {
    if (open) {
      setWhat('category');
      setValue('');
      setMin(undefined);
      setMax(undefined);
    }
  }, [open]);

  const n = products.length === 1 ? '1 producto' : `${products.length} productos`;
  const options =
    what === 'category' ? lk.categories : what === 'location' ? lk.locations : what === 'supplier' ? lk.suppliers : what === 'unit' ? lk.units.map((u) => ({ id: u.id, name: `${u.name} (${u.abbreviation})` })) : [];
  const none = what === 'category' ? 'Sin familia' : what === 'location' ? 'Sin ubicación' : what === 'supplier' ? 'Sin proveedor' : 'Sin unidad';

  const patch: BulkPatch | null = (() => {
    if (what === 'minmax') {
      if (min === undefined && max === undefined) return null;
      return { ...(min !== undefined ? { minStock: min } : {}), ...(max !== undefined ? { maxStock: max } : {}) };
    }
    if (what === 'active') return value === '' ? null : { active: value === 'si' };
    if (value === '') return null;
    const id = value === '-' ? undefined : value;
    return what === 'category' ? { categoryId: id } : what === 'location' ? { locationId: id } : what === 'supplier' ? { supplierId: id } : { unitId: id };
  })();

  const describe = (): string => {
    if (!patch) return '';
    if (what === 'minmax') return [min !== undefined && `mínimo ${min}`, max !== undefined && `máximo ${max}`].filter(Boolean).join(' y ');
    if (what === 'active') return value === 'si' ? 'quedan activos' : 'quedan inactivos (no aparecen en conteos ni pedidos)';
    const label = WHAT.find((w) => w.value === what)!.label.toLowerCase();
    return `${label}: ${value === '-' ? none.toLowerCase() : options.find((o) => o.id === value)?.name}`;
  };

  const apply = async () => {
    if (!patch) return;
    const r = await run(() => bulkUpdateProducts(products.map((p) => p.id), patch));
    if (!r) return;
    notify(r.changed ? `${r.changed === 1 ? '1 producto actualizado' : `${r.changed} productos actualizados`}.` : 'No había nada para cambiar: ya tenían ese valor.', r.changed ? { undo: r.undo.restore } : undefined);
    onDone();
  };

  return (
    <Modal
      open={open}
      title={`Cambiar ${n}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={!patch} onClick={apply}>Aplicar a {n}</button>
        </>
      }
    >
      <div className="stack">
        <Field label="Qué cambiar">
          <Select value={what} onChange={(e) => { setWhat(e.target.value as What); setValue(''); }}>
            {WHAT.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </Select>
        </Field>
        {what === 'minmax' ? (
          <div className="form-grid cols-2">
            <Field label="Mínimo" hint="vacío = no cambiar"><NumberInput value={min} onChange={setMin} min={0} /></Field>
            <Field label="Máximo" hint="vacío = no cambiar"><NumberInput value={max} onChange={setMax} min={0} /></Field>
          </div>
        ) : what === 'active' ? (
          <Field label="Estado">
            <Select value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Elegí…</option>
              <option value="si">Activos</option>
              <option value="no">Inactivos</option>
            </Select>
          </Field>
        ) : (
          <Field label="Nuevo valor">
            <Select value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Elegí…</option>
              <option value="-">{none}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
        )}
        {patch && (
          <div className="alert alert-info stack-sm">
            <span>En <b>{n}</b>: <b>{describe()}</b>. El stock no se toca y podés deshacerlo.</span>
            <span className="small muted">{products.slice(0, 5).map((p) => p.name).join(', ')}{products.length > 5 ? ` y ${products.length - 5} más` : ''}.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

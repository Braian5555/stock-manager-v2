import { useEffect, useState } from 'react';
import { useLookups } from '../../hooks/useData';
import type { Product } from '../../models';
import type { ProductionLine } from '../../services/bakeryService';
import { createQuickProduct, LINE_FAMILY_NAME } from '../../services/lineProductService';
import { useFeedback } from '../../store/feedback';
import { Field, Input, Segmented, Select } from '../ui';
import { Modal } from '../ui/Modal';

type Kind = 'elaborado' | 'insumo';

/**
 * Producto nuevo desde Producción / Pastelería (para la panadera o la pastelera, sin entrar a Productos).
 * Lo que se elabora queda en la familia de la sección y se abre su receta; un insumo, en la familia elegida.
 */
export function NewProductModal({ open, line, initialName = '', lineFamilies, onClose, onCreated }: {
  open: boolean;
  line: ProductionLine;
  initialName?: string;
  /** Familias de la sección (para mostrar dónde va lo elaborado). */
  lineFamilies: string[];
  onClose: () => void;
  onCreated: (p: Product, kind: Kind) => void;
}) {
  const lk = useLookups();
  const { run } = useFeedback();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('elaborado');
  const [unitId, setUnitId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setKind('elaborado');
    setUnitId(lk.units.find((u) => u.abbreviation === 'u')?.id ?? lk.units[0]?.id ?? '');
    setCategoryId(lk.categories.find((c) => /almac/i.test(c.name))?.id ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- sólo al abrir

  const lineFamily = lineFamilies.map((id) => lk.category(id)).filter(Boolean)[0] || LINE_FAMILY_NAME[line];
  const save = async () => {
    const p = await run(() => createQuickProduct({ name, unitId: unitId || undefined, elaborated: kind === 'elaborado', line, categoryId: kind === 'insumo' ? categoryId || undefined : undefined }), `Creado “${name.trim()}”`);
    if (p) onCreated(p, kind);
  };

  return (
    <Modal open={open} title="Producto nuevo" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={save}>{kind === 'elaborado' ? 'Crear y cargar receta' : 'Crear insumo'}</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(); }}>
        <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={line === 'pastry' ? 'Ej.: Torta rogel' : 'Ej.: Pan de campo'} autoFocus /></Field>
        <Segmented<Kind> label="Qué es" value={kind} onChange={setKind}
          options={[{ value: 'elaborado', label: 'Lo elaboramos' }, { value: 'insumo', label: 'Es un insumo' }]} />
        <Field label="Se cuenta en">
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {lk.units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
          </Select>
        </Field>
        {kind === 'insumo' ? (
          <Field label="Familia">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin familia</option>
              {lk.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Queda en la familia <b>{lineFamily}</b>{lineFamilies.length ? '' : ' (se crea ahora)'} y después cargás su receta.</p>
        )}
      </form>
    </Modal>
  );
}

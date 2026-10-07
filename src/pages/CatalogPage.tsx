import { useLiveQuery } from 'dexie-react-hooks';
import { MapPin, Mail, Pencil, Phone, Plus, Ruler, Tags, Trash2, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Table } from 'dexie';
import { db } from '../database/db';
import type { BaseEntity, ModuleKey } from '../models';
import { countProductsUsing, deleteCatalogItem, saveEntity, type Draft } from '../services/entityService';
import { menuLabel } from '../services/settingsService';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { useProducts, EMPTY } from '../hooks/useData';
import { Modal } from '../components/ui/Modal';
import { EmptyState, Field, Input, PageHeader, SearchInput, Textarea } from '../components/ui';
import { matches } from '../utils/format';

type Kind = 'category' | 'unit' | 'location' | 'supplier';
interface FieldDef { key: string; label: string; type?: 'text' | 'email' | 'tel' | 'textarea'; required?: boolean; placeholder?: string }
type Row = BaseEntity & Record<string, unknown> & { name: string };

const CONFIG: Record<Kind, { module: ModuleKey; singular: string; icon: typeof Tags; table: () => Table<Row, string>; fields: FieldDef[]; productField: 'categoryId' | 'unitId' | 'locationId' | 'supplierId'; help?: string; male?: boolean }> = {
  category: { module: 'categories', singular: 'familia', icon: Tags, table: () => db.categories as unknown as Table<Row, string>, fields: [{ key: 'name', label: 'Nombre', required: true, placeholder: 'Ej.: Bebidas' }], productField: 'categoryId' },
  unit: {
    module: 'units', singular: 'unidad', icon: Ruler, table: () => db.units as unknown as Table<Row, string>, productField: 'unitId',
    fields: [{ key: 'name', label: 'Nombre', required: true, placeholder: 'Ej.: Cajón' }, { key: 'abbreviation', label: 'Abreviatura', required: true, placeholder: 'Ej.: cajón' }],
    help: 'Las equivalencias (1 caja = 12 unidades) se configuran en cada producto: unidad de compra y unidad de stock.',
  },
  location: {
    module: 'locations', singular: 'ubicación', icon: MapPin, table: () => db.locations as unknown as Table<Row, string>, productField: 'locationId',
    fields: [{ key: 'name', label: 'Nombre', required: true, placeholder: 'Ej.: Depósito central' }, { key: 'description', label: 'Descripción', type: 'textarea' }],
  },
  supplier: {
    module: 'suppliers', singular: 'proveedor', male: true, icon: Truck, table: () => db.suppliers as unknown as Table<Row, string>, productField: 'supplierId',
    fields: [
      { key: 'name', label: 'Nombre', required: true, placeholder: 'Ej.: Distribuidora Ejemplo' },
      { key: 'contact', label: 'Contacto' },
      { key: 'phone', label: 'Teléfono', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Dirección' },
      { key: 'notes', label: 'Notas', type: 'textarea' },
    ],
  },
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function CatalogPage({ kind }: { kind: Kind }) {
  const cfg = CONFIG[kind];
  const settings = useSettings();
  const products = useProducts();
  const { run, confirm, notify } = useFeedback();
  const rows = useLiveQuery(() => cfg.table().orderBy('name').toArray(), [kind]) ?? EMPTY;
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Partial<Row> | null>(null);
  const Icon = cfg.icon;

  useEffect(() => {
    const id = params.get('editar');
    if (id && rows.length) {
      const r = rows.find((x) => x.id === id);
      if (r) setEditing(r);
      setParams({}, { replace: true });
    }
  }, [params, rows, setParams]);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      const ids = kind === 'supplier' ? [p.supplierId, ...p.alternativeSupplierIds] : kind === 'unit' ? [p.unitId, p.purchaseUnitId] : [p[cfg.productField]];
      for (const id of new Set(ids)) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [products, kind, cfg.productField]);

  const list = rows.filter((r) => matches(q, ...cfg.fields.map((f) => r[f.key] as string | undefined)));

  const save = async () => {
    if (!editing) return;
    for (const f of cfg.fields) if (f.required && !String(editing[f.key] ?? '').trim()) return notify(`Completá “${f.label}”.`, { tone: 'error' });
    const clean = Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || undefined : v]));
    const ok = await run(() => saveEntity(cfg.table(), clean as Draft<Row>), editing.id ? 'Cambios guardados' : `${cap(cfg.singular)} ${cfg.male ? 'creado' : 'creada'}`);
    if (ok) setEditing(null);
  };

  const remove = async (r: Row) => {
    const n = await countProductsUsing(kind, r.id);
    const ok = await confirm({
      title: `Eliminar ${cfg.singular}`,
      message: (
        <>
          <p>¿Eliminar <strong>{r.name}</strong>?</p>
          {n > 0 && <p className="alert alert-warn">{n} {n === 1 ? `producto ${cfg.male ? 'lo' : 'la'} usa y quedará` : `productos ${cfg.male ? 'lo' : 'la'} usan y quedarán`} sin {cfg.singular}. Los productos no se eliminan.</p>}
        </>
      ),
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const undo = await run(() => deleteCatalogItem(kind, r.id));
    if (undo) notify(`"${r.name}" eliminado`, { undo: undo.restore });
  };

  return (
    <>
      <PageHeader
        title={menuLabel(settings, cfg.module)}
        subtitle={cfg.help}
        actions={<button type="button" className="btn btn-primary" onClick={() => setEditing({})}><Plus size={18} aria-hidden /> {cfg.male ? 'Nuevo' : 'Nueva'} {cfg.singular}</button>}
      />
      <div className="toolbar"><SearchInput value={q} onChange={setQ} /></div>
      <div className="card">
        {list.length === 0 ? (
          <EmptyState icon={<Icon size={40} />} title={rows.length ? 'Sin resultados' : `No hay ${menuLabel(settings, cfg.module).toLowerCase()}`} />
        ) : (
          <div className="list">
            {list.map((r) => (
              <div key={r.id} className="list-item">
                <Icon size={18} className="muted" aria-hidden />
                <div className="grow">
                  <div className="list-title truncate">
                    {r.name} {kind === 'unit' && <span className="muted">({String(r.abbreviation ?? '')})</span>}
                  </div>
                  <div className="list-sub row wrap" style={{ gap: '2px 12px' }}>
                    <span>{usage.get(r.id) ?? 0} productos</span>
                    {kind === 'supplier' && typeof r.phone === 'string' && <a href={`tel:${r.phone}`} className="row" style={{ gap: 4 }}><Phone size={12} aria-hidden />{r.phone}</a>}
                    {kind === 'supplier' && typeof r.email === 'string' && <a href={`mailto:${r.email}`} className="row" style={{ gap: 4 }}><Mail size={12} aria-hidden />{r.email}</a>}
                    {kind === 'supplier' && typeof r.contact === 'string' && <span>{r.contact}</span>}
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Editar ${r.name}`} onClick={() => setEditing(r)}><Pencil size={16} /></button>
                <button type="button" className="btn btn-sm btn-ghost icon-btn btn-danger" aria-label={`Eliminar ${r.name}`} onClick={() => remove(r)}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Modal
        open={!!editing}
        title={editing?.id ? `Editar ${cfg.singular}` : `${cfg.male ? 'Nuevo' : 'Nueva'} ${cfg.singular}`}
        onClose={() => setEditing(null)}
        footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" form="catalog-form" className="btn btn-primary">Guardar</button></>}
      >
        <form id="catalog-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {cfg.fields.map((f, i) => (
            <Field key={f.key} label={f.label} hint={f.required ? undefined : 'opcional'}>
              {f.type === 'textarea' ? (
                <Textarea value={String(editing?.[f.key] ?? '')} onChange={(e) => setEditing((x) => ({ ...x, [f.key]: e.target.value }))} />
              ) : (
                <Input type={f.type ?? 'text'} value={String(editing?.[f.key] ?? '')} placeholder={f.placeholder} required={f.required} data-autofocus={i === 0 ? true : undefined}
                  onChange={(e) => setEditing((x) => ({ ...x, [f.key]: e.target.value }))} />
              )}
            </Field>
          ))}
        </form>
      </Modal>
    </>
  );
}

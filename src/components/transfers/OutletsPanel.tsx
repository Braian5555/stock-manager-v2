import { Pencil, Plus, Store } from 'lucide-react';
import { useState } from 'react';
import type { Outlet } from '../../models';
import { deleteOutlet, saveOutlet } from '../../services/transferService';
import { useOutlets } from '../../hooks/useData';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { Modal } from '../ui/Modal';
import { Badge, EmptyState, Field, Input } from '../ui';

type Form = { id?: string; name: string; maxirestName: string; active: boolean };

export function OutletsPanel() {
  const outlets = useOutlets();
  const { run, confirm } = useFeedback();
  const [form, setForm] = useState<Form>();
  const { can } = useSession();
  // Crear, editar y borrar puntos es configuración: administradores o quien administra catálogos.
  const canEdit = can('admin') || can('catalog.manage');

  const save = async () => {
    if (!form) return;
    if (await run(() => saveOutlet(form), form.id ? 'Punto actualizado' : 'Punto creado')) setForm(undefined);
  };
  const remove = async () => {
    if (!form?.id) return;
    if (!(await confirm({ title: 'Eliminar punto', message: `¿Eliminar “${form.name}”?`, danger: true, confirmLabel: 'Eliminar' }))) return;
    if (await run(async () => { await deleteOutlet(form.id!); return true; }, 'Punto eliminado')) setForm(undefined);
  };
  const edit = (o: Outlet) => setForm({ id: o.id, name: o.name, maxirestName: o.maxirestName ?? '', active: o.active });

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <p className="small muted grow" style={{ margin: 0 }}>Los lugares que reciben mercadería del Depósito Central.</p>
        {canEdit && <button type="button" className="btn btn-primary" onClick={() => setForm({ name: '', maxirestName: '', active: true })}><Plus size={18} aria-hidden /> Nuevo punto</button>}
      </div>
      <div className="card">
        {outlets.length === 0 ? (
          <EmptyState icon={<Store size={40} />} title="Todavía no hay puntos">Creá cada punto gastronómico (por ejemplo: Parador, Confitería, Xenote) para poder mandarles mercadería.</EmptyState>
        ) : (
          <div className="list">
            {outlets.map((o) => (
              <button key={o.id} type="button" className="list-item invoice-item" disabled={!canEdit} onClick={() => edit(o)} aria-label={canEdit ? `Editar ${o.name}` : o.name}>
                <span className="stat-icon" aria-hidden><Store size={16} /></span>
                <div className="grow">
                  <div className="list-title truncate">{o.name}</div>
                  <div className="list-sub">{o.maxirestName ? `En Maxirest: ${o.maxirestName}` : 'Sin nombre de Maxirest'}</div>
                </div>
                {!o.active && <Badge>Desactivado</Badge>}
                {canEdit && <Pencil size={16} className="muted" aria-hidden />}
              </button>
            ))}
          </div>
        )}
      </div>
      <Modal open={!!form} title={form?.id ? 'Editar punto' : 'Nuevo punto'} onClose={() => setForm(undefined)}
        footer={<>
          {form?.id && <button type="button" className="btn btn-danger" onClick={remove}>Eliminar</button>}
          <button type="button" className="btn" onClick={() => setForm(undefined)}>Cancelar</button>
          <button type="submit" form="outlet-form" className="btn btn-primary">Guardar</button>
        </>}>
        {form && (
          <form id="outlet-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label="Nombre del punto"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Parador" data-autofocus /></Field>
            <Field label="Nombre en Maxirest" hint="opcional"><Input value={form.maxirestName} onChange={(e) => setForm({ ...form, maxirestName: e.target.value })} placeholder="Como figura el depósito en Maxirest" /></Field>
            <label className="row small"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Activo (se le pueden mandar remitos)</label>
          </form>
        )}
      </Modal>
    </>
  );
}

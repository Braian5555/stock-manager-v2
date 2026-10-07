import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { db } from '../database/db';
import type { CountBaseline, CountStatus } from '../models';
import { startCount } from '../services/countService';
import { menuLabel } from '../services/settingsService';
import { useIntegration, useLookups, useOutlets, EMPTY } from '../hooks/useData';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Modal } from '../components/ui/Modal';
import { Badge, EmptyState, Field, Input, PageHeader, Select } from '../components/ui';
import { fmtDateTime } from '../utils/format';

export const COUNT_STATUS: Record<CountStatus, { label: string; tone: string }> = {
  abierto: { label: 'En curso', tone: 'info' },
  finalizado: { label: 'Finalizado', tone: 'warn' },
  aplicado: { label: 'Aplicado', tone: 'ok' },
  descartado: { label: 'Descartado', tone: '' },
};

export function CountsPage() {
  const settings = useSettings();
  const lk = useLookups();
  const integration = useIntegration();
  const navigate = useNavigate();
  const { run } = useFeedback();
  const counts = useLiveQuery(() => db.counts.orderBy('createdAt').reverse().toArray(), []) ?? EMPTY;
  const itemCounts = useLiveQuery(async () => {
    const items = await db.countItems.toArray();
    const m = new Map<string, { total: number; done: number }>();
    for (const i of items) {
      const e = m.get(i.countId) ?? { total: 0, done: 0 };
      e.total++;
      if (i.counted !== undefined) e.done++;
      m.set(i.countId, e);
    }
    return m;
  }, []);
  const hasExternal = (useLiveQuery(() => db.externalReferences.where({ system: 'maxirest', entityType: 'product' }).count(), []) ?? 0) > 0;
  const [open, setOpen] = useState(false);
  const outlets = useOutlets();
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const [form, setForm] = useState<{ name: string; locationId: string; categoryId: string; baseline: CountBaseline; outletId: string }>({ name: '', locationId: '', categoryId: '', baseline: 'local', outletId: '' });

  const create = async () => {
    const c = await run(() => startCount({ name: form.name, locationId: form.locationId || undefined, categoryId: form.categoryId || undefined, baseline: form.baseline, outletId: form.outletId || undefined }));
    if (c) navigate(`/conteo/${c.id}`);
  };

  return (
    <>
      <PageHeader
        title={menuLabel(settings, 'count')}
        subtitle="Contá físicamente, compará y ajustá"
        actions={<button type="button" className="btn btn-primary" onClick={() => { setForm({ name: '', locationId: '', categoryId: '', outletId: '', baseline: integration?.stockAuthority === 'maxirest' && hasExternal ? 'maxirest' : 'local' }); setOpen(true); }}><Plus size={18} aria-hidden /> Nuevo conteo</button>}
      />
      <div className="card">
        {counts.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={40} />} title="Sin conteos">Iniciá un conteo completo, por ubicación o por familia.</EmptyState>
        ) : (
          <div className="list">
            {counts.map((c) => {
              const n = itemCounts?.get(c.id);
              return (
                <Link key={c.id} to={`/conteo/${c.id}`} className="list-item">
                  <ClipboardCheck size={18} className="muted" aria-hidden />
                  <div className="grow">
                    <div className="list-title truncate">{c.name}</div>
                    <div className="list-sub">
                      {fmtDateTime(c.createdAt)} · {n ? `${n.done}/${n.total} contados` : '—'}
                      {c.outletId && ` · ${outletName.get(c.outletId) ?? 'Punto'}`}
                      {c.locationId && ` · ${lk.location(c.locationId)}`}
                      {c.categoryId && ` · ${lk.category(c.categoryId)}`}
                      {c.baseline === 'maxirest' && ' · contra Maxirest'}
                    </div>
                  </div>
                  <Badge tone={COUNT_STATUS[c.status].tone}>{COUNT_STATUS[c.status].label}</Badge>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <Modal open={open} title="Nuevo conteo" onClose={() => setOpen(false)}
        footer={<><button type="button" className="btn" onClick={() => setOpen(false)}>Cancelar</button><button type="submit" form="count-form" className="btn btn-primary">Empezar conteo</button></>}>
        <form id="count-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label="Nombre" hint="opcional"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`Conteo ${new Date().toLocaleDateString('es-AR')}`} data-autofocus /></Field>
          {outlets.some((o) => o.active) && (
            <Field label="Dónde se cuenta">
              <Select value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}>
                <option value="">Depósito Central</option>
                {outlets.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
          )}
          {!form.outletId && (
            <Field label="Ubicación">
              <Select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                <option value="">Todas las ubicaciones</option>
                {lk.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Familia">
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Todas las familias</option>
              {lk.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          {hasExternal && !form.outletId && (
            <Field label="Comparar contra">
              <Select value={form.baseline} onChange={(e) => setForm({ ...form, baseline: e.target.value as CountBaseline })}>
                <option value="local">Stock de Stock Manager</option>
                <option value="maxirest">Stock informado por Maxirest</option>
              </Select>
            </Field>
          )}
        </form>
      </Modal>
    </>
  );
}

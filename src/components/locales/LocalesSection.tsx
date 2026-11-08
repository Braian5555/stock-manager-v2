import { useLiveQuery } from 'dexie-react-hooks';
import { Monitor, Pencil, Plus, Store } from 'lucide-react';
import { useState } from 'react';
import { db } from '../../database/db';
import { EMPTY } from '../../hooks/useData';
import type { Outlet } from '../../models';
import { setDeviceLocal, useLocalScope } from '../../services/localScope';
import { saveOutlet } from '../../services/transferService';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { EmptyState, Field, Input, NumberInput, PageHeader } from '../ui';
import { Modal } from '../ui/Modal';
import { allowedLocals } from './LocalGate';

/**
 * Locales (sucursales), como las instalaciones de Maxirest: cada uno con su número, su punto de
 * venta de ARCA y su encabezado. Cada equipo se asigna a un local y trabaja sólo con lo de ese local.
 */
export function LocalesSection() {
  const { can, user } = useSession();
  const admin = can('admin');
  const scope = useLocalScope();
  const all = (useLiveQuery(() => db.outlets.toArray(), []) ?? EMPTY) as Outlet[];
  const list = [...all].sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', 'es', { numeric: true }) || a.name.localeCompare(b.name, 'es'));
  const [editing, setEditing] = useState<Partial<Outlet> | null>(null);
  const mine = allowedLocals(scope.outlets, user?.outletIds, admin);

  return (
    <>
      <PageHeader title="Locales" subtitle="Cada local tiene sus mesas, carta, ventas, caja y comprobantes, y factura con su punto de venta. Cada compu trabaja en un local." />

      <section className="card card-pad stack" aria-labelledby="this-device">
        <h2 id="this-device" className="row" style={{ margin: 0, gap: 8, fontSize: '1.1rem' }}><Monitor size={20} aria-hidden /> Este equipo</h2>
        {scope.outlets.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>Todavía no hay locales: Orillas trabaja como un solo local. Cargá los locales abajo.</p>
        ) : (
          <Field label="Local de este equipo" hint="Lo que se haga en esta compu (mesas, ventas, caja, facturas) queda en este local.">
            <select className="input" aria-label="Local de este equipo" value={scope.current?.id ?? ''} onChange={(e) => setDeviceLocal(e.target.value || undefined)} disabled={mine.length < 2 && !!scope.current}>
              {!scope.current && <option value="">Elegí el local…</option>}
              {mine.map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} · ` : ''}{o.name}</option>)}
            </select>
          </Field>
        )}
      </section>

      <section className="card" aria-labelledby="locales-list">
        <div className="card-head">
          <h2 id="locales-list">Locales</h2>
          {admin && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ active: true })}><Plus size={16} aria-hidden /> Nuevo local</button>}
        </div>
        {list.length === 0 ? (
          <EmptyState icon={<Store size={40} />} title="Sin locales">Cargá cada local con su número y su punto de venta de ARCA (el de Maxirest).</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>N.º</th><th>Local</th><th className="num">Punto de venta</th><th>Estado</th>{admin && <th><span className="sr-only">Editar</span></th>}</tr></thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id}>
                    <td>{o.code ?? '—'}</td>
                    <td>{o.name}{scope.current?.id === o.id ? <span className="small muted"> · este equipo</span> : null}</td>
                    <td className="num">{o.ptoVta ?? '—'}</td>
                    <td>{o.active ? 'Activo' : 'Inactivo'}</td>
                    {admin && <td><button type="button" className="btn btn-sm" aria-label={`Editar ${o.name}`} onClick={() => setEditing(o)}><Pencil size={16} aria-hidden /> Editar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && <LocalModal value={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function LocalModal({ value, onClose }: { value: Partial<Outlet>; onClose: () => void }) {
  const { run, notify } = useFeedback();
  const [name, setName] = useState(value.name ?? '');
  const [code, setCode] = useState(value.code ?? '');
  const [pv, setPv] = useState<number | undefined>(value.ptoVta);
  const [header, setHeader] = useState(value.ticketHeader ?? '');
  const [active, setActive] = useState(value.active ?? true);
  const save = () => void run(async () => {
    await saveOutlet({ id: value.id, name, code, ptoVta: pv, ticketHeader: header, active, maxirestName: value.maxirestName });
    notify(value.id ? 'Local guardado' : 'Local creado');
    onClose();
  });
  return (
    <Modal open title={value.id ? `Local: ${value.name}` : 'Nuevo local'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="form-grid cols-2">
        <Field label="Nombre del local" hint="Sale en el ticket como “Sucursal: …”."><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Xenote" /></Field>
        <Field label="Número de local" hint="El de Maxirest."><Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Punto de venta de ARCA" hint="Cada local factura con el suyo (no repetir)."><NumberInput value={pv} onChange={setPv} min={1} /></Field>
        <Field label="Encabezado del ticket (opcional)" hint="Un renglón por línea; vacío: el general.">
          <textarea className="input" rows={3} value={header} onChange={(e) => setHeader(e.target.value)} />
        </Field>
      </div>
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Local activo</label>
    </Modal>
  );
}

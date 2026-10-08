import { AlertOctagon, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { wipeAllData, wipeSummary, type WipeSummary } from '../services/resetService';
import { useSession } from '../store/session';
import { useFeedback } from '../store/feedback';
import { Field, Input } from './ui';
import { Modal } from './ui/Modal';
import { fmtNumber } from '../utils/format';

const LABELS: [keyof WipeSummary, string][] = [
  ['products', 'Productos'], ['movements', 'Movimientos'], ['orders', 'Pedidos'], ['counts', 'Conteos'],
  ['invoices', 'Facturas'], ['invoiceImages', 'Fotos de facturas'], ['transfers', 'Remitos'], ['outlets', 'Puntos'],
  ['suppliers', 'Proveedores'], ['categories', 'Familias'], ['units', 'Unidades'], ['locations', 'Ubicaciones'],
];

/** Configuración → "Eliminar todos los datos", con confirmación por PIN del usuario actual. */
export function WipeDataSection() {
  const { user, login, cloudMode } = useSession();
  const { notify } = useFeedback();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<WipeSummary | null>(null);
  const [pin, setPin] = useState('');
  const [recreate, setRecreate] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setPin('');
    setError('');
    setRecreate(true);
    setSummary(await wipeSummary());
    setOpen(true);
  };

  const confirm = async () => {
    if (!user || busy) return;
    if (!/^\d{4,6}$/.test(pin)) return setError('Ingresá tu PIN (4 a 6 números).');
    setBusy(true);
    setError('');
    try {
      await login(user.id, pin); // mismo control (y bloqueo por intentos) que la pantalla de PIN
    } catch (e) {
      setBusy(false);
      setPin('');
      return setError(e instanceof Error ? e.message : 'PIN incorrecto.');
    }
    try {
      await wipeAllData({ recreateBaseCatalogs: recreate });
      setOpen(false);
      notify(cloudMode ? 'Datos eliminados. Se están borrando también de la nube y de los demás dispositivos.' : 'Datos eliminados.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron eliminar los datos.');
    } finally {
      setBusy(false);
    }
  };

  const items = summary ? LABELS.filter(([k]) => summary[k] > 0) : [];

  return (
    <section className="card card-pad stack danger-zone" aria-labelledby="borrar-todo">
      <h2 id="borrar-todo" className="row"><AlertOctagon size={18} aria-hidden /> Eliminar todos los datos</h2>
      <p className="small muted">
        Deja el negocio en cero: borra productos, stock, movimientos, pedidos, conteos, facturas, remitos, proveedores y catálogos.
        Se conservan los usuarios y esta configuración.{cloudMode && ' Como este dispositivo está vinculado a la nube, también se borra de la nube y de los demás dispositivos.'}
      </p>
      <div><button type="button" className="btn btn-danger" onClick={() => void start()}><Trash2 size={18} aria-hidden /> Eliminar todos los datos</button></div>

      <Modal open={open} title="Eliminar todos los datos" onClose={() => !busy && setOpen(false)}
        footer={<>
          <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
          <button type="submit" form="wipe-form" className="btn btn-danger-solid" disabled={busy}>{busy ? 'Eliminando…' : 'Eliminar todo'}</button>
        </>}>
        <form id="wipe-form" className="stack" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
          <div className="alert alert-danger"><span><b>No se puede deshacer.</b> Si querés guardar una copia, hacé antes un backup desde “Exportar y backup”.</span></div>
          {items.length > 0 ? (
            <dl className="kv">
              {items.map(([k, label]) => <div key={k} style={{ display: 'contents' }}><dt>{label}</dt><dd>{fmtNumber(summary![k])}</dd></div>)}
            </dl>
          ) : <p className="small muted">No hay datos para borrar.</p>}
          <label className="check small">
            <input type="checkbox" checked={recreate} onChange={(e) => setRecreate(e.target.checked)} />
            Volver a crear las unidades, familias y ubicaciones de base (kg, litro, caja, Bebidas, Depósito central…)
          </label>
          <Field label={`PIN de ${user?.name ?? 'tu usuario'}`} hint="para confirmar">
            <Input type="password" inputMode="numeric" autoComplete="off" value={pin} data-autofocus
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} />
          </Field>
          {cloudMode && <p className="small muted">Si entrás con email y nunca elegiste un PIN, primero ponete uno en <b>Usuarios</b> (editá tu usuario → PIN nuevo).</p>}
          {error && <p role="alert" className="small" style={{ color: 'var(--out)', margin: 0 }}>{error}</p>}
        </form>
      </Modal>
    </section>
  );
}

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { createBackup } from '../services/backupService';
import { resetStockKeepCatalog, stockResetSummary } from '../services/resetService';
import { downloadBlob, stamp } from '../exports/download';
import { toJsonBlob } from '../exports/writers';
import { useSession } from '../store/session';
import { useFeedback } from '../store/feedback';
import { Field, Input } from './ui';
import { Modal } from './ui/Modal';
import { fmtNumber } from '../utils/format';

const LABELS: [string, string][] = [
  ['withStock', 'Productos con stock (quedan en 0)'], ['movements', 'Movimientos'], ['counts', 'Conteos'], ['withPlan', 'Planes de producción'],
  ['invoices', 'Facturas'], ['invoiceImages', 'Fotos de facturas'], ['orders', 'Pedidos'], ['transfers', 'Remitos'],
];

/**
 * Configuración → "Empezar de cero": stock en 0 y sin historia, pero conservando productos,
 * familias, unidades, recetas, usuarios y configuración. Pide el PIN y antes descarga una copia.
 */
export function StockResetSection() {
  const { user, login, can, cloudMode } = useSession();
  const { notify } = useFeedback();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setPin('');
    setError('');
    setSummary(await stockResetSummary());
    setOpen(true);
  };

  const confirm = async () => {
    if (!user || busy) return;
    if (!/^\d{4,6}$/.test(pin)) return setError('Ingresá tu PIN (4 a 6 números).');
    setBusy(true);
    setError('');
    try {
      await login(user.id, pin);
    } catch (e) {
      setBusy(false);
      setPin('');
      return setError(e instanceof Error ? e.message : 'PIN incorrecto.');
    }
    try {
      // Copia completa antes de borrar: si algo sale mal se restaura desde "Exportar y backup".
      downloadBlob(toJsonBlob(await createBackup({ includeUsers: can('admin') })), `backup_antes-de-empezar-de-cero_${stamp()}.json`);
      const r = await resetStockKeepCatalog();
      setOpen(false);
      notify(`Listo: ${fmtNumber(r.products)} productos en 0 y ${fmtNumber(r.movements)} movimientos borrados.${cloudMode ? ' Se está aplicando también en la nube y los demás dispositivos.' : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  };

  const items = summary ? LABELS.filter(([k]) => (summary[k] ?? 0) > 0) : [];

  return (
    <section className="card card-pad stack danger-zone" aria-labelledby="empezar-cero">
      <h2 id="empezar-cero" className="row"><RotateCcw size={18} aria-hidden /> Empezar de cero (conservar productos y recetas)</h2>
      <p className="small muted">
        Pone todo el stock en 0 y borra la historia: movimientos, conteos, planes de producción, facturas, pedidos y remitos.
        Quedan los productos, familias, unidades, ubicaciones, recetas, usuarios y esta configuración. Antes se descarga una copia de respaldo.
        {cloudMode && ' También se aplica en la nube y en los demás dispositivos.'}
      </p>
      <div><button type="button" className="btn btn-danger" onClick={() => void start()}><RotateCcw size={18} aria-hidden /> Empezar de cero</button></div>

      <Modal open={open} title="Empezar de cero" onClose={() => !busy && setOpen(false)}
        footer={<>
          <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
          <button type="submit" form="reset-form" className="btn btn-danger-solid" disabled={busy}>{busy ? 'Aplicando…' : 'Poner todo en 0'}</button>
        </>}>
        <form id="reset-form" className="stack" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
          <div className="alert alert-danger"><span><b>No se puede deshacer desde la app.</b> Se descarga una copia de respaldo justo antes, por si hace falta volver atrás.</span></div>
          {items.length > 0 ? (
            <dl className="kv">
              {items.map(([k, label]) => <div key={k} style={{ display: 'contents' }}><dt>{label}</dt><dd>{fmtNumber(summary![k])}</dd></div>)}
            </dl>
          ) : <p className="small muted">Ya está todo en 0.</p>}
          <p className="small muted">Se conservan los productos y sus recetas.</p>
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

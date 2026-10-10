import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../database/db';
import type { MovementType, Product } from '../models';
import { MOVEMENT_LABEL, OUTGOING_TYPES, applyMovement, revertMovement } from '../services/stockService';
import { canSyncAdjustments, syncedAdjustment } from '../integrations/integrationService';
import { useIntegration, useLookups } from '../hooks/useData';
import { useFeedback } from '../store/feedback';
import { fmtNumber, fmtSigned, round3 } from '../utils/format';
import { Modal } from './ui/Modal';
import { Field, NumberInput, Select, Input } from './ui';

const TYPES: MovementType[] = ['ingreso', 'salida', 'ajuste', 'consumo', 'perdida', 'devolucion'];

export function MovementModal({ product, onClose, initialType = 'ingreso' }: { product: Product | null; onClose: () => void; initialType?: MovementType }) {
  const lk = useLookups();
  const { run, notify, confirm } = useFeedback();
  const integration = useIntegration();
  const [type, setType] = useState<MovementType>(initialType);
  const [qty, setQty] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'local' | 'sync'>('local');
  const [canSync, setCanSync] = useState(false);
  const link = product?.externalSystems?.maxirest;
  const ref = useLiveQuery(
    () => (link ? db.externalReferences.where({ system: 'maxirest', entityType: 'product', externalId: link.id }).first() : undefined),
    [link?.id],
  );

  useEffect(() => {
    if (!product) return;
    setType(initialType);
    setQty(undefined);
    setReason('');
    setMode('local');
    canSyncAdjustments().then(setCanSync).catch(() => setCanSync(false));
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reiniciar sólo al cambiar de producto

  if (!product) return null;
  const unit = lk.unit(product.unitId);
  const isAdjust = type === 'ajuste';
  const newQty = qty === undefined ? undefined : isAdjust ? qty : round3(product.stock + (OUTGOING_TYPES.includes(type) ? -qty : qty));
  const integrated = integration && integration.mode !== 'disabled' && integration.status !== 'desconectado' && !!link;

  const submit = async () => {
    if (newQty === undefined || qty === undefined || qty < 0) return notify('Ingresá una cantidad válida.', { tone: 'error' });
    if (!isAdjust && qty === 0) return notify('La cantidad tiene que ser mayor a 0.', { tone: 'error' });
    if (isAdjust && newQty === product.stock) return notify('El stock ya tiene esa cantidad: no hay nada que ajustar.', { tone: 'error' });
    if (isAdjust && mode === 'sync') {
      const ok = await confirm({
        title: '¿Confirmar ajuste sincronizado?',
        message: (
          <dl className="kv">
            <dt>Producto</dt><dd>{product.name}</dd>
            <dt>Stock Maxirest</dt><dd className="num">{fmtNumber(ref?.stock)}</dd>
            <dt>Nuevo stock</dt><dd className="num">{fmtNumber(newQty)}</dd>
            <dt>Diferencia</dt><dd className="num">{ref?.stock !== undefined ? fmtSigned(round3(newQty - ref.stock)) : '—'}</dd>
          </dl>
        ),
        confirmLabel: 'Confirmar ajuste',
      });
      if (!ok) return;
      const r = await run(() => syncedAdjustment(product.id, newQty, reason || 'Ajuste'));
      if (r) {
        notify(r.job.status === 'sincronizado' ? 'Ajuste aplicado y enviado a Maxirest.' : r.job.error ?? 'El ajuste quedó pendiente de sincronizar.', { tone: r.job.status === 'sincronizado' ? 'info' : 'error' });
        onClose();
      }
      return;
    }
    // Ajuste = fija la cantidad; el resto suma o resta (así se combinan bien los
    // movimientos hechos en distintos dispositivos al mismo tiempo).
    const r = await run(() =>
      applyMovement(
        isAdjust
          ? { productId: product.id, type, newQuantity: newQty, reason, origin: 'manual' }
          : { productId: product.id, type, delta: round3(newQty - product.stock), reason, origin: 'manual' },
      ),
    );
    if (r) {
      notify(`${MOVEMENT_LABEL[type]} registrado: ${fmtNumber(r.movement.quantityBefore)} → ${fmtNumber(r.movement.quantityAfter)}`, {
        undo: () => revertMovement(r.movement).then(() => undefined),
      });
      onClose();
    }
  };

  return (
    <Modal
      open
      title={`Movimiento · ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={newQty === undefined}>Registrar</button>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Tipo de movimiento">
          <Select value={type} onChange={(e) => setType(e.target.value as MovementType)}>
            {TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label={isAdjust ? 'Nueva cantidad en stock' : 'Cantidad'} hint={unit || undefined}>
          <NumberInput value={qty} onChange={setQty} min={0} data-autofocus required />
        </Field>
        <Field label="Motivo" hint="opcional">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: rotura, consumo interno, devolución a proveedor…" />
        </Field>
        {isAdjust && integrated && (
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small muted" style={{ marginBottom: 6 }}>Tipo de ajuste</legend>
            <label className="check"><input type="radio" name="adj" checked={mode === 'local'} onChange={() => setMode('local')} /> Ajuste local (sólo Stock Manager)</label>
            <label className="check">
              <input type="radio" name="adj" checked={mode === 'sync'} disabled={!canSync} onChange={() => setMode('sync')} />
              Ajuste sincronizado (Stock Manager → Maxirest)
            </label>
            {!canSync && <p className="small muted">La integración actual no permite enviar ajustes a Maxirest.</p>}
            {mode === 'local' && integration?.stockAuthority === 'maxirest' && (
              <p className="small muted">Maxirest es la fuente principal: un ajuste local se reemplazará en la próxima sincronización.</p>
            )}
          </fieldset>
        )}
        {newQty !== undefined && newQty < 0 && (
          <div className="alert alert-warn" role="status">
            <span>El stock va a quedar <strong>en negativo</strong>: estás sacando más de lo que figura. Se puede registrar igual; después conviene revisarlo con un conteo.</span>
          </div>
        )}
        <div className="alert">
          <span>Stock actual <strong className="num">{fmtNumber(product.stock)}</strong> → nuevo <strong className="num">{fmtNumber(newQty)}</strong> {unit}
            {newQty !== undefined && <> (<span className={newQty - product.stock >= 0 ? 'pos' : 'neg'}>{fmtSigned(round3(newQty - product.stock))}</span>)</>}
          </span>
        </div>
      </form>
    </Modal>
  );
}

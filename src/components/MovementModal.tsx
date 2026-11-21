import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../database/db';
import type { MovementType, Product } from '../models';
import { MOVEMENT_LABEL, OUTGOING_TYPES, applyMovement, revertMovement, similarRecentIngresos } from '../services/stockService';
import { canSyncAdjustments, syncedAdjustment } from '../integrations/integrationService';
import { useIntegration, useLookups } from '../hooks/useData';
import { useSettings } from '../store/settings';
import { negativeStockOn } from '../services/settingsService';
import { maxirestOn } from '../layouts/modules';
import { useFeedback } from '../store/feedback';
import { fmtNumber, fmtSigned, fmtTime, round3 } from '../utils/format';
import { Modal } from './ui/Modal';
import { Field, NumberInput, Select, Input } from './ui';

const TYPES: MovementType[] = ['ingreso', 'salida', 'ajuste', 'consumo', 'perdida', 'devolucion'];

/** `outlet`: el movimiento es en ese punto (su stock, no el del Depósito Central). */
export function MovementModal({ product, onClose, initialType = 'ingreso', outlet }: { product: Product | null; onClose: () => void; initialType?: MovementType; outlet?: { id: string; name: string; stock: number } }) {
  const lk = useLookups();
  const { run, notify, confirm } = useFeedback();
  const integration = useIntegration();
  const [type, setType] = useState<MovementType>(initialType);
  const [qty, setQty] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  // Cantidad en la unidad de compra (cajas, bultos…): la app la pasa a la unidad de stock.
  const [inPacks, setInPacks] = useState(false);
  const [mode, setMode] = useState<'local' | 'sync'>('local');
  const [canSync, setCanSync] = useState(false);
  const settings = useSettings();
  const mxOn = maxirestOn(settings);
  const allowNegative = negativeStockOn(settings);
  const link = mxOn ? product?.externalSystems?.maxirest : undefined;
  const ref = useLiveQuery(
    () => (link ? db.externalReferences.where({ system: 'maxirest', entityType: 'product', externalId: link.id }).first() : undefined),
    [link?.id],
  );

  useEffect(() => {
    if (!product) return;
    setType(initialType);
    setQty(undefined);
    setReason('');
    setInPacks(false);
    setMode('local');
    canSyncAdjustments().then(setCanSync).catch(() => setCanSync(false));
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reiniciar sólo al cambiar de producto

  if (!product) return null;
  // En un punto se parte de lo que hay en ese punto.
  const base = outlet ? outlet.stock : product.stock;
  const unit = lk.unit(product.unitId);
  const isAdjust = type === 'ajuste';
  const factor = product.purchaseUnitId && product.purchaseFactor > 1 ? product.purchaseFactor : 0;
  const packUnit = factor ? lk.unit(product.purchaseUnitId) : '';
  const packs = !!factor && inPacks && !isAdjust;
  // Lo que se mueve, siempre en la unidad de stock.
  const units = qty === undefined ? undefined : packs ? round3(qty * factor) : qty;
  const newQty = units === undefined ? undefined : isAdjust ? units : round3(base + (OUTGOING_TYPES.includes(type) ? -units : units));
  // Sin stock negativo, una salida no baja de 0: lo que se ve es cómo va a quedar.
  const floor = Math.min(base, 0);
  const shownQty = newQty !== undefined && !isAdjust && !allowNegative && newQty < floor ? floor : newQty;
  const integrated = !outlet && mxOn && integration && integration.mode !== 'disabled' && integration.status !== 'desconectado' && !!link;

  const submit = async () => {
    if (newQty === undefined || qty === undefined || qty < 0) return notify('Ingresá una cantidad válida.', { tone: 'error' });
    if (!isAdjust && qty === 0) return notify('La cantidad tiene que ser mayor a 0.', { tone: 'error' });
    if (isAdjust && newQty === base) return notify('El stock ya tiene esa cantidad: no hay nada que ajustar.', { tone: 'error' });
    // Lo mismo cargado dos veces (dos personas, o factura y a mano): se pregunta antes.
    if (type === 'ingreso' && units !== undefined) {
      const twins = await similarRecentIngresos(product.id, outlet?.id, units);
      if (twins.length) {
        const m = twins[0];
        const when = new Date(m.createdAt);
        const ok = await confirm({
          title: '¿Ya lo cargaste?',
          message: `Hace poco entraron ${fmtNumber(m.delta)} ${unit} de ${product.name}${outlet ? ` en ${outlet.name}` : ''} (${when.toLocaleDateString('es-AR')} ${fmtTime(m.createdAt)}${m.reason ? `, ${m.reason}` : ''}${m.performedBy ? `, ${m.performedBy.name}` : ''}). Si es la misma mercadería, no la cargues de nuevo.`,
          confirmLabel: 'Registrar igual',
        });
        if (!ok) return;
      }
    }
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
          ? { productId: product.id, type, newQuantity: newQty, reason, origin: 'manual', outletId: outlet?.id }
          : { productId: product.id, type, delta: round3(newQty - base), reason, origin: 'manual', outletId: outlet?.id },
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
      title={outlet ? `Movimiento en ${outlet.name} · ${product.name}` : `Movimiento · ${product.name}`}
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
        <Field label={isAdjust ? 'Nueva cantidad en stock' : 'Cantidad'} hint={packs ? `${packUnit} de ${fmtNumber(factor)} ${unit}` : unit || undefined}>
          <NumberInput value={qty} onChange={setQty} min={0} data-autofocus required />
        </Field>
        {!!factor && !isAdjust && (
          <div className="row wrap" role="radiogroup" aria-label="Unidad de la cantidad" style={{ gap: 12 }}>
            <label className="check"><input type="radio" name="mv-unit" checked={!inPacks} onChange={() => setInPacks(false)} /> En {unit || 'unidades'}</label>
            <label className="check"><input type="radio" name="mv-unit" checked={inPacks} onChange={() => setInPacks(true)} /> En {packUnit} (1 = {fmtNumber(factor)} {unit})</label>
            {packs && units !== undefined && <span className="small muted">= {fmtNumber(units)} {unit}</span>}
          </div>
        )}
        <Field label="Motivo" hint="opcional">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: rotura, consumo interno, devolución a proveedor…" />
        </Field>
        {isAdjust && integrated && (
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small muted" style={{ marginBottom: 6 }}>Tipo de ajuste</legend>
            <label className="check"><input type="radio" name="adj" checked={mode === 'local'} onChange={() => setMode('local')} /> Ajuste local (sólo Orillas)</label>
            <label className="check">
              <input type="radio" name="adj" checked={mode === 'sync'} disabled={!canSync} onChange={() => setMode('sync')} />
              Ajuste sincronizado (Orillas → Maxirest)
            </label>
            {!canSync && <p className="small muted">La integración actual no permite enviar ajustes a Maxirest.</p>}
            {mode === 'local' && integration?.stockAuthority === 'maxirest' && (
              <p className="small muted">Maxirest es la fuente principal: un ajuste local se reemplazará en la próxima sincronización.</p>
            )}
          </fieldset>
        )}
        {newQty !== undefined && newQty < 0 && (allowNegative || isAdjust) && (
          <div className="alert alert-warn" role="status">
            <span>El stock va a quedar <strong>en negativo</strong>: estás sacando más de lo que figura. Se puede registrar igual; después conviene revisarlo con un conteo.</span>
          </div>
        )}
        {shownQty !== newQty && (
          <div className="alert alert-warn" role="status">
            <span>No alcanza: hay {fmtNumber(Math.max(0, base))} {unit}{outlet ? ` en ${outlet.name}` : ''}. Queda en <strong>0</strong> y el movimiento anota cuánto faltaba.</span>
          </div>
        )}
        <div className="alert">
          <span>{outlet ? `Stock en ${outlet.name}` : 'Stock actual'} <strong className="num">{fmtNumber(base)}</strong> → nuevo <strong className="num">{fmtNumber(shownQty)}</strong> {unit}
            {shownQty !== undefined && <> (<span className={shownQty - base >= 0 ? 'pos' : 'neg'}>{fmtSigned(round3(shownQty - base))}</span>)</>}
          </span>
        </div>
      </form>
    </Modal>
  );
}

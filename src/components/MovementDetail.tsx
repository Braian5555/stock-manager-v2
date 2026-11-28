import { Link } from 'react-router';
import { Pencil, Undo2 } from 'lucide-react';
import type { StockMovement } from '../models';
import { MOVEMENT_LABEL } from '../services/stockService';
import { Modal } from './ui/Modal';
import { Badge } from './ui';
import { fmtDate, fmtNumber, fmtSigned, fmtTime } from '../utils/format';

/** Movimientos que salieron de la misma operación (remito, factura, producción, conteo…) o se cargaron juntos. */
export function relatedMovements(m: StockMovement, all: readonly StockMovement[]): { list: StockMovement[]; sameRef: boolean } {
  const byRef = all.filter((x) => x.id !== m.id && ((!!m.refId && (x.refId === m.refId || x.id === m.refId)) || x.refId === m.id));
  if (byRef.length) return { list: byRef, sameRef: true };
  // Sin referencia: lo que la misma persona cargó con el mismo motivo en esos minutos (p. ej. "Producción 25/11").
  if (!m.reason) return { list: [], sameRef: false };
  const t = Date.parse(m.createdAt);
  const near = all.filter((x) => x.id !== m.id && x.reason === m.reason && x.performedBy?.id === m.performedBy?.id
    && Math.abs(Date.parse(x.createdAt) - t) <= 10 * 60_000);
  return { list: near, sameRef: false };
}

interface Props {
  movement: StockMovement;
  all: readonly StockMovement[];
  productName: (m: StockMovement) => string;
  placeOf: (m: StockMovement) => string;
  originLabel: string;
  showPlace: boolean;
  reverted: boolean;
  canEdit: boolean;
  canRevert: boolean;
  onEdit: () => void;
  onRevert: () => void;
  onOpen: (m: StockMovement) => void;
  onClose: () => void;
}

export function MovementDetail({ movement: m, all, productName, placeOf, originLabel, showPlace, reverted, canEdit, canRevert, onEdit, onRevert, onOpen, onClose }: Props) {
  const { list: related, sameRef } = relatedMovements(m, all);
  const refLink = m.refId && m.origin === 'remito' ? { to: `/remitos?ver=${m.refId}`, label: 'Ver el remito' }
    : m.refId && m.origin === 'factura' ? { to: `/facturas?ver=${m.refId}`, label: 'Ver la factura' }
    : undefined;
  const sorted = [...related].sort((a, b) => productName(a).localeCompare(productName(b), 'es'));

  return (
    <Modal open title="Detalle del movimiento" onClose={onClose}
      footer={<>
        {canEdit && <button type="button" className="btn" onClick={onEdit}><Pencil size={16} aria-hidden /> Corregir motivo</button>}
        {canRevert && <button type="button" className="btn" onClick={onRevert}><Undo2 size={16} aria-hidden /> Revertir</button>}
        <button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="stack">
        <div>
          <strong style={{ fontSize: '1.05rem' }}>{productName(m)}</strong>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <Badge>{MOVEMENT_LABEL[m.type]}</Badge>
            {reverted && <Badge tone="warn">Revertido</Badge>}
            {m.sourceSystem === 'maxirest' && <Badge tone="info">Maxirest</Badge>}
          </div>
        </div>
        <dl className="kv" aria-label="Datos del movimiento">
          <dt>Fecha</dt><dd>{fmtDate(m.createdAt)} {fmtTime(m.createdAt)}</dd>
          {showPlace && <><dt>Lugar</dt><dd>{placeOf(m)}</dd></>}
          <dt>Cantidad</dt><dd className={`num ${m.delta >= 0 ? 'pos' : 'neg'}`}>{fmtSigned(m.delta)}</dd>
          <dt>Stock</dt><dd className="num">{fmtNumber(m.quantityBefore)} → {fmtNumber(m.quantityAfter)}</dd>
          <dt>Motivo</dt><dd>{m.reason || '—'}</dd>
          {m.reasonEditedAt && <><dt>Motivo original</dt><dd>{m.originalReason || '(sin motivo)'}{m.reasonEditedBy ? ` · corregido por ${m.reasonEditedBy.name}` : ''}</dd></>}
          <dt>Usuario</dt><dd>{m.performedBy?.name ?? '—'}</dd>
          <dt>Origen</dt><dd>{originLabel}</dd>
        </dl>
        {refLink && <Link to={refLink.to} className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>{refLink.label}</Link>}
        {sorted.length > 0 && (
          <section aria-label="Movimientos de la misma operación">
            <h3 className="small muted" style={{ margin: '4px 0 6px' }}>
              {sameRef ? 'En la misma operación' : 'Cargado junto con'} ({sorted.length})
            </h3>
            <div className="list">
              {sorted.map((x) => (
                <button key={x.id} type="button" className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => onOpen(x)}
                  aria-label={`Ver movimiento de ${productName(x)}`}>
                  <div className="grow">
                    <div className="list-title truncate">{productName(x)}</div>
                    <div className="list-sub truncate">{MOVEMENT_LABEL[x.type]}{showPlace ? ` · ${placeOf(x)}` : ''}</div>
                  </div>
                  <strong className={`num ${x.delta >= 0 ? 'pos' : 'neg'}`}>{fmtSigned(x.delta)}</strong>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

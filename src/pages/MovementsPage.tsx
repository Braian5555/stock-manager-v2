import { useSession } from '../store/session';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeftRight, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db } from '../database/db';
import { MOVEMENT_TYPES, type MovementType, type StockMovement } from '../models';
import { MOVEMENT_LABEL, revertMovement } from '../services/stockService';
import { menuLabel } from '../services/settingsService';
import { useProducts, EMPTY } from '../hooks/useData';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Badge, EmptyState, Field, Input, PageHeader, SearchInput, Select } from '../components/ui';
import { fmtDate, fmtNumber, fmtSigned, fmtTime, matches } from '../utils/format';

const ORIGIN_LABEL: Record<StockMovement['origin'], string> = {
  manual: 'Manual', conteo: 'Conteo', pedido: 'Pedido', importacion: 'Importación', sincronizacion: 'Sincronización', deshacer: 'Deshacer', alta: 'Alta de producto',
};
const PAGE = 100;

export function MovementsPage() {
  const settings = useSettings();
  const products = useProducts();
  const { run, confirm } = useFeedback();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [type, setType] = useState<MovementType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const all = useLiveQuery(() => db.movements.orderBy('createdAt').reverse().toArray(), []) ?? EMPTY;
  const reverted = useMemo(() => new Set(all.filter((m) => m.idempotencyKey.startsWith('undo:')).map((m) => m.idempotencyKey.slice(5))), [all]);
  const name = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);

  const list = all.filter((m) =>
    (!type || m.type === type) &&
    (!from || m.createdAt.slice(0, 10) >= from) &&
    (!to || m.createdAt.slice(0, 10) <= to) &&
    matches(q, name.get(m.productId), m.reason),
  );

  const revert = async (m: StockMovement) => {
    if (!(await confirm({ title: 'Revertir movimiento', message: `Se registrará un ajuste de ${fmtSigned(-m.delta)} en “${name.get(m.productId)}”. El historial se conserva.`, confirmLabel: 'Revertir' }))) return;
    await run(() => revertMovement(m), 'Movimiento revertido');
  };

  return (
    <>
      <PageHeader title={menuLabel(settings, 'movements')} subtitle={`${list.length} movimientos`} />
      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Buscar por producto o motivo" /></div>
      <div className="filters">
        <Select aria-label="Tipo" value={type} onChange={(e) => setType(e.target.value as MovementType | '')}>
          <option value="">Todos los tipos</option>
          {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}
        </Select>
        <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="card">
        {list.length === 0 ? (
          <EmptyState icon={<ArrowLeftRight size={40} />} title="Sin movimientos" />
        ) : (
          <>
          <div className="list show-mobile">
            {list.slice(0, limit).map((m) => (
              <div key={m.id} className="list-item">
                <div className="grow">
                  <div className="list-title truncate">{name.get(m.productId) ?? '(producto eliminado)'}</div>
                  <div className="list-sub">{MOVEMENT_LABEL[m.type]} · {fmtDate(m.createdAt)} {fmtTime(m.createdAt)} · {ORIGIN_LABEL[m.origin]}{m.sourceSystem === 'maxirest' ? ' · Maxirest' : ''}</div>
                  <div className="list-sub num">{fmtNumber(m.quantityBefore)} → {fmtNumber(m.quantityAfter)}{m.reason ? ` · ${m.reason}` : ''}{m.performedBy ? ` · ${m.performedBy.name}` : ''}</div>
                </div>
                <strong className={`num ${m.delta >= 0 ? 'pos' : 'neg'}`}>{fmtSigned(m.delta)}</strong>
                {can('stock.move') && m.origin !== 'deshacer' && name.has(m.productId) && !reverted.has(m.id) && (
                  <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label="Revertir movimiento" onClick={() => revert(m)}><Undo2 size={16} /></button>
                )}
              </div>
            ))}
          </div>
          <div className="table-wrap hide-mobile">
            <table className="table">
              <thead>
                <tr><th>Producto</th><th>Fecha</th><th>Hora</th><th>Tipo</th><th className="num">Anterior</th><th className="num">Nuevo</th><th className="num">Diferencia</th><th>Motivo</th><th>Usuario</th><th>Origen</th><th><span className="sr-only">Acciones</span></th></tr>
              </thead>
              <tbody>
                {list.slice(0, limit).map((m) => (
                  <tr key={m.id}>
                    <td className="cell-title">{name.get(m.productId) ?? '(producto eliminado)'}</td>
                    <td data-label="Fecha">{fmtDate(m.createdAt)}</td>
                    <td data-label="Hora">{fmtTime(m.createdAt)}</td>
                    <td data-label="Tipo"><Badge>{MOVEMENT_LABEL[m.type]}</Badge></td>
                    <td data-label="Anterior" className="num">{fmtNumber(m.quantityBefore)}</td>
                    <td data-label="Nuevo" className="num">{fmtNumber(m.quantityAfter)}</td>
                    <td data-label="Diferencia" className={`num ${m.delta >= 0 ? 'pos' : 'neg'}`}><b>{fmtSigned(m.delta)}</b></td>
                    <td data-label="Motivo">{m.reason ?? '—'}</td>
                    <td data-label="Usuario">{m.performedBy?.name ?? '—'}</td>
                    <td data-label="Origen">
                      {ORIGIN_LABEL[m.origin]}
                      {m.sourceSystem === 'maxirest' && <> <Badge tone="info">Maxirest</Badge></>}
                      {m.syncId && m.sourceSystem === 'local' && <> <Badge tone="primary">Sync</Badge></>}
                    </td>
                    <td data-label="Acciones">
                      {can('stock.move') && m.origin !== 'deshacer' && name.has(m.productId) && !reverted.has(m.id) && (
                        <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label="Revertir movimiento" title="Revertir" onClick={() => revert(m)}><Undo2 size={16} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        {list.length > limit && <div className="card-pad"><button type="button" className="btn btn-block" onClick={() => setLimit((l) => l + PAGE)}>Ver más</button></div>}
      </div>
    </>
  );
}

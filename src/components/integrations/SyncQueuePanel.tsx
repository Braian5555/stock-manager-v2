import { useLiveQuery } from 'dexie-react-hooks';
import { RotateCw } from 'lucide-react';
import { db } from '../../database/db';
import type { SyncJobStatus } from '../../models';
import { retryJob, syncPending } from '../../integrations/integrationService';
import { useFeedback } from '../../store/feedback';
import { useProducts, EMPTY } from '../../hooks/useData';
import { Badge, EmptyState } from '../ui';
import { fmtDateTime, fmtNumber } from '../../utils/format';

const STATUS: Record<SyncJobStatus, { label: string; tone: string }> = {
  pendiente: { label: 'Pendiente', tone: 'warn' },
  sincronizado: { label: 'Sincronizado', tone: 'ok' },
  error: { label: 'Error', tone: 'error' },
};
const OP: Record<string, string> = { createStockAdjustment: 'Ajuste de stock', updateInventory: 'Inventario', createOrder: 'Pedido' };

export function SyncQueuePanel({ connected }: { connected: boolean }) {
  const { run, notify } = useFeedback();
  const jobs = useLiveQuery(() => db.syncJobs.orderBy('createdAt').reverse().limit(100).toArray(), []) ?? EMPTY;
  const products = useProducts();
  const byExt = new Map(products.filter((p) => p.externalSystems?.maxirest).map((p) => [p.externalSystems!.maxirest!.id, p.name]));
  const open = jobs.filter((j) => j.status !== 'sincronizado').length;

  if (!jobs.length) return <EmptyState title="Cola vacía">Los ajustes enviados a Maxirest aparecerán aquí.</EmptyState>;
  return (
    <div className="stack">
      {open > 0 && (
        <div className="row between wrap">
          <span className="small">Movimientos pendientes: <b>{open}</b></span>
          <button type="button" className="btn btn-sm" disabled={!connected} onClick={() => run(syncPending).then((r) => r && notify(`${r.ok} sincronizados${r.failed ? `, ${r.failed} con error` : ''}.`))}>
            Sincronizar pendientes
          </button>
        </div>
      )}
      <div className="list card">
        {jobs.map((j) => (
          <div key={j.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="list-title">{OP[j.operation] ?? j.operation} · {byExt.get(String(j.payload.productExternalId)) ?? String(j.payload.productExternalId ?? '')}</div>
              <div className="list-sub">{fmtDateTime(j.createdAt)} · nuevo stock {fmtNumber(Number(j.payload.newQuantity))} · intentos {j.attempts}</div>
              {j.error && <div className="small" style={{ color: 'var(--out)', marginTop: 4 }}>{j.error}</div>}
              {j.technicalError && <details className="small muted"><summary>Detalle técnico</summary>{j.technicalError}</details>}
            </div>
            <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
              <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge>
              {j.status !== 'sincronizado' && (
                <button type="button" className="btn btn-sm" disabled={!connected} onClick={() => run(() => retryJob(j.id)).then((r) => r && notify(r.status === 'sincronizado' ? 'Sincronizado' : r.error ?? 'Sigue pendiente', { tone: r.status === 'sincronizado' ? 'info' : 'error' }))}>
                  <RotateCw size={14} aria-hidden /> Reintentar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

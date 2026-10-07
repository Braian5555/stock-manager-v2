import { useLiveQuery } from 'dexie-react-hooks';
import { Scale } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { db } from '../database/db';
import { buildReconciliation, RECON_LABEL, type ReconRow, type ReconState } from '../integrations/core/reconciliation';
import { canSyncAdjustments, syncedAdjustment } from '../integrations/integrationService';
import { applyMovement, revertMovement } from '../services/stockService';
import { menuLabel } from '../services/settingsService';
import { useIntegration, useProducts } from '../hooks/useData';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Badge, EmptyState, PageHeader, SearchInput, Select } from '../components/ui';
import { fmtNumber, fmtSigned, matches } from '../utils/format';

const TONE: Record<ReconState, string> = { igual: 'ok', positiva: 'info', negativa: 'warn', no_vinculado: '', sin_dato: '', error: 'error' };
const NO_REFS: never[] = [];

export function ReconciliationPage() {
  const settings = useSettings();
  const products = useProducts();
  const integ = useIntegration();
  const { run, confirm, notify } = useFeedback();
  const refs = useLiveQuery(() => db.externalReferences.where({ system: 'maxirest', entityType: 'product' }).toArray(), []) ?? NO_REFS;
  const jobs = useLiveQuery(() => db.syncJobs.where('status').equals('error').toArray(), []) ?? NO_REFS;
  const [filter, setFilter] = useState<ReconState | 'diferencias' | ''>('');
  const [q, setQ] = useState('');
  const [canSync, setCanSync] = useState(false);
  useEffect(() => void canSyncAdjustments().then(setCanSync).catch(() => setCanSync(false)), [integ?.status, integ?.mode]);

  const rows = useMemo(() => buildReconciliation(products, refs, jobs), [products, refs, jobs]);
  const shown = rows.filter((r) =>
    matches(q, r.product?.name, r.ref?.name, r.ref?.code, r.product?.sku) &&
    (!filter || (filter === 'diferencias' ? r.state === 'positiva' || r.state === 'negativa' : r.state === filter)),
  );
  const count = (s: ReconState) => rows.filter((r) => r.state === s).length;

  const alignLocal = async (r: ReconRow) => {
    if (!r.product || r.external === undefined) return;
    const ok = await confirm({
      title: 'Ajuste local',
      message: <dl className="kv"><dt>Producto</dt><dd>{r.product.name}</dd><dt>Stock Maxirest</dt><dd>{fmtNumber(r.external)}</dd><dt>Stock Stock Manager</dt><dd>{fmtNumber(r.local)}</dd><dt>Nuevo stock local</dt><dd>{fmtNumber(r.external)}</dd></dl>,
      confirmLabel: 'Confirmar ajuste',
    });
    if (!ok) return;
    const res = await run(() => applyMovement({ productId: r.product!.id, type: 'ajuste', newQuantity: r.external!, reason: 'Conciliación con Maxirest', origin: 'manual' }));
    if (res) notify('Stock local ajustado', { undo: () => revertMovement(res.movement).then(() => undefined) });
  };

  const pushExternal = async (r: ReconRow) => {
    if (!r.product || r.external === undefined) return;
    const ok = await confirm({
      title: '¿Confirmar ajuste en Maxirest?',
      message: <dl className="kv"><dt>Producto</dt><dd>{r.product.name}</dd><dt>Stock Maxirest</dt><dd>{fmtNumber(r.external)}</dd><dt>Stock Manager / conteo</dt><dd>{fmtNumber(r.local)}</dd><dt>Diferencia</dt><dd>{fmtSigned((r.local ?? 0) - r.external)}</dd></dl>,
      confirmLabel: 'Confirmar ajuste',
    });
    if (!ok) return;
    const res = await run(() => syncedAdjustment(r.product!.id, r.local ?? 0, 'Conciliación'));
    if (res) notify(res.job.status === 'sincronizado' ? 'Maxirest actualizado' : res.job.error ?? 'Quedó pendiente', { tone: res.job.status === 'sincronizado' ? 'info' : 'error' });
  };

  return (
    <>
      <PageHeader title={menuLabel(settings, 'reconciliation')} subtitle="Stock Manager vs. Maxirest" />
      {integ?.mode === 'mock' && <div className="alert alert-demo" style={{ marginBottom: 12 }}>Modo demostración — Maxirest simulado.</div>}
      {refs.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Scale size={40} />} title="Sin datos de Maxirest" action={<Link to="/integraciones" className="btn btn-primary">Ir a Integraciones</Link>}>
            Sincronizá Maxirest o importá el Excel de inventario para comparar el stock.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid grid-stats" style={{ marginBottom: 12 }}>
            {(['igual', 'positiva', 'negativa', 'no_vinculado', 'error'] as ReconState[]).map((s) => (
              <button key={s} type="button" className="card stat" style={{ textAlign: 'left', cursor: 'pointer', outline: filter === s ? '2px solid var(--primary)' : undefined }} onClick={() => setFilter(filter === s ? '' : s)}>
                <span className="stat-value">{count(s)}</span><span className="stat-label">{RECON_LABEL[s]}</span>
              </button>
            ))}
          </div>
          <div className="toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar producto o insumo" />
            <Select aria-label="Filtro" value={filter} onChange={(e) => setFilter(e.target.value as ReconState | '')} style={{ maxWidth: 240 }}>
              <option value="">Todos</option>
              <option value="diferencias">Con diferencias</option>
              {(Object.keys(RECON_LABEL) as ReconState[]).map((s) => <option key={s} value={s}>{RECON_LABEL[s]}</option>)}
            </Select>
          </div>
          <div className="card table-wrap">
            <table className="table responsive">
              <thead><tr><th>Producto</th><th className="num">Stock Maxirest</th><th className="num">Stock Stock Manager</th><th className="num">Diferencia</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key}>
                    <td className="cell-title">{r.product?.name ?? r.ref?.name}{r.ref?.code && <div className="small muted" style={{ fontWeight: 400 }}>Maxirest {r.ref.code}{r.ref.source === 'excel' ? ' · Excel' : ''}</div>}</td>
                    <td data-label="Stock Maxirest" className="num">{fmtNumber(r.external)}</td>
                    <td data-label="Stock Stock Manager" className="num">{fmtNumber(r.local)}</td>
                    <td data-label="Diferencia" className={`num ${(r.difference ?? 0) < 0 ? 'neg' : (r.difference ?? 0) > 0 ? 'pos' : ''}`}><b>{r.difference === undefined ? '—' : fmtSigned(r.difference)}</b></td>
                    <td data-label="Estado"><Badge tone={TONE[r.state]}>{RECON_LABEL[r.state]}</Badge>{r.error && <div className="small" style={{ color: 'var(--out)' }}>{r.error}</div>}</td>
                    <td data-label="Acciones">
                      <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
                        {(r.state === 'positiva' || r.state === 'negativa') && <button type="button" className="btn btn-sm" onClick={() => alignLocal(r)}>Ajuste local</button>}
                        {(r.state === 'positiva' || r.state === 'negativa') && canSync && <button type="button" className="btn btn-sm" onClick={() => pushExternal(r)}>Ajustar Maxirest</button>}
                        {r.state === 'no_vinculado' && <Link to="/integraciones?tab=vinculos" className="btn btn-sm">Vincular</Link>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>Diferencia = Stock Manager − Maxirest. Ningún ajuste se aplica sin tu confirmación.</p>
        </>
      )}
    </>
  );
}

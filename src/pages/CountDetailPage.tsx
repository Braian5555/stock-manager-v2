import { useSession } from '../store/session';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Send } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { db } from '../database/db';
import { applyCount, discardCount, finishCount, reopenCount, setCounted, summarizeCount, type CountLine } from '../services/countService';
import { canSyncAdjustments, sendCountToExternal } from '../integrations/integrationService';
import { exportBridgeWorkbook } from '../integrations/maxirest/excelBridgeExport';
import { useLookups, useProducts, EMPTY } from '../hooks/useData';
import { useFeedback } from '../store/feedback';
import { Badge, EmptyState, PageHeader, SearchInput, Segmented } from '../components/ui';
import { Stepper } from '../components/Stepper';
import { fmtNumber, fmtSigned, matches } from '../utils/format';
import { COUNT_STATUS } from './CountsPage';
import { useIncremental } from '../hooks/useIncremental';
import { GroupBar, useProductGroups } from '../components/GroupBar';
import type { InventoryCountItem as CountItem, Product } from '../models';

type Row = { i: CountItem; p: Product | undefined };
const prodOf = (r: Row) => r.p;

type Show = 'all' | 'pending' | 'done';

export function CountDetailPage() {
  const { id = '' } = useParams();
  const count = useLiveQuery(async () => (await db.counts.get(id)) ?? null, [id]);
  const items = useLiveQuery(() => db.countItems.where('countId').equals(id).toArray(), [id]) ?? EMPTY;
  const products = useProducts();
  const lk = useLookups();
  const { run, confirm, notify } = useFeedback();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [showExpected, setShowExpected] = useState(true);
  const [canSync, setCanSync] = useState(false);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  useEffect(() => void canSyncAdjustments().then(setCanSync).catch(() => setCanSync(false)), []);

  const rows = useMemo(
    () =>
      items
        .map((i) => ({ i, p: byId.get(i.productId) }))
        .filter(({ i, p }) => p && matches(q, p.name, p.sku) && (show === 'all' || (show === 'done') === (i.counted !== undefined)))
        .sort((a, b) => a.p!.name.localeCompare(b.p!.name, 'es')),
    [items, byId, q, show],
  );
  const summary = useMemo(() => summarizeCount(items), [items]);
  // Al contar con el filtro "Pendientes" la lista se achica: no se reinicia la tanda por eso.
  // Agrupado por familia, ubicación o unidad: se puede contar sólo "Hormas" o sólo una cámara.
  const g = useProductGroups(rows, prodOf, lk);
  const { visible: shownRows, sentinel } = useIncremental(g.shown, `${q}|${g.mode}|${g.group}|${show}`);

  if (count === undefined) return <p className="muted">Cargando…</p>;
  if (count === null || !count) return <EmptyState title="Conteo no encontrado" action={<Link className="btn" to="/conteo">Volver</Link>} />;

  const editable = count.status === 'abierto';
  const linkedDiffs = [...summary.increases, ...summary.decreases].filter((l) => byId.get(l.item.productId)?.externalSystems?.maxirest);
  const name = (l: CountLine) => byId.get(l.item.productId)?.name ?? '(eliminado)';

  const finish = async () => {
    if (summary.uncounted > 0) {
      const ok = await confirm({ title: 'Finalizar conteo', message: <p>Hay {summary.uncounted} productos sin contar. No se modificarán. ¿Finalizar igual?</p>, confirmLabel: 'Finalizar' });
      if (!ok) return;
    }
    await run(() => finishCount(id));
  };

  const apply = async () => {
    const changes = [...summary.increases, ...summary.decreases];
    const ok = await confirm({
      title: 'Aplicar conteo al stock',
      message: (
        <>
          <p>Se ajustará el stock {count.outletId ? 'del punto' : 'de Stock Manager'} a las cantidades contadas ({changes.length} productos con diferencia).</p>
          {count.baseline === 'maxirest' && <p className="small muted">Esto ajusta sólo Stock Manager. Para Maxirest usá “Enviar a Maxirest” o el Excel.</p>}
        </>
      ),
      confirmLabel: 'Aplicar ajustes',
    });
    if (!ok) return;
    const n = await run(() => applyCount(id));
    if (n !== undefined) notify(`Conteo aplicado: ${n} ajustes registrados.`);
  };

  const send = async () => {
    const ok = await confirm({
      title: '¿Enviar ajustes a Maxirest?',
      message: (
        <div className="stack-sm">
          {linkedDiffs.slice(0, 12).map((l) => (
            <div key={l.item.id} className="result-line small"><span className="grow">{name(l)}</span><span className="num">{count.baseline === 'maxirest' ? 'Maxirest' : 'Esperado'} {fmtNumber(l.item.expected)} → Conteo {fmtNumber(l.item.counted)} (<b>{fmtSigned(l.difference)}</b>)</span></div>
          ))}
          {linkedDiffs.length > 12 && <p className="small muted">…y {linkedDiffs.length - 12} más.</p>}
        </div>
      ),
      confirmLabel: 'Confirmar ajustes',
    });
    if (!ok) return;
    const r = await run(() => sendCountToExternal(id));
    if (r) notify(r.failed ? `${r.ok} enviados, ${r.failed} quedaron pendientes para reintentar.` : `${r.ok} ajustes enviados a Maxirest.`, { tone: r.failed ? 'error' : 'info' });
  };

  return (
    <>
      <Link to="/conteo" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}><ArrowLeft size={16} aria-hidden /> Conteos</Link>
      <PageHeader
        title={count.name}
        subtitle={<>{summary.counted} de {summary.total} contados {count.baseline === 'maxirest' && '· comparando contra Maxirest'} · <Badge tone={COUNT_STATUS[count.status].tone}>{COUNT_STATUS[count.status].label}</Badge></>}
        actions={editable ? <button type="button" className="btn btn-primary" onClick={finish}><CheckCircle2 size={18} aria-hidden /> Finalizar conteo</button> : undefined}
      />

      {!editable && (
        <section className="card card-pad stack" style={{ marginBottom: 16 }} aria-labelledby="resumen">
          <h2 id="resumen">Resultado</h2>
          <div className="grid grid-stats">
            <div className="card stat"><span className="stat-value">{summary.counted}</span><span className="stat-label">Productos contados</span></div>
            <div className="card stat"><span className="stat-value">{summary.increases.length + summary.decreases.length}</span><span className="stat-label">Con diferencias</span></div>
            <div className="card stat"><span className="stat-value pos">{summary.increases.length}</span><span className="stat-label">Aumentos</span></div>
            <div className="card stat"><span className="stat-value neg">{summary.decreases.length}</span><span className="stat-label">Disminuciones</span></div>
            <div className="card stat"><span className="stat-value">{summary.unchanged.length}</span><span className="stat-label">Sin cambios</span></div>
            <div className="card stat"><span className="stat-value">{summary.uncounted}</span><span className="stat-label">Sin contar</span></div>
          </div>
          {[...summary.decreases, ...summary.increases].length > 0 && (
            <div>
              {[...summary.decreases, ...summary.increases].map((l) => (
                <div key={l.item.id} className="result-line">
                  <span className="grow truncate">{name(l)}</span>
                  <span className="small muted num">{fmtNumber(l.item.expected)} → {fmtNumber(l.item.counted)}</span>
                  <strong className={`num ${l.difference > 0 ? 'pos' : 'neg'}`}>{fmtSigned(l.difference)}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="row wrap">
            {count.status === 'finalizado' && can('count.apply') && <button type="button" className="btn btn-primary" onClick={apply}>Aplicar al stock</button>}
            {count.status === 'finalizado' && <button type="button" className="btn" onClick={() => run(() => reopenCount(id))}>Seguir contando</button>}
            {canSync && !count.outletId && can('admin') && linkedDiffs.length > 0 && count.status !== 'descartado' && <button type="button" className="btn" onClick={send}><Send size={16} aria-hidden /> Enviar a Maxirest</button>}
            {can('export') && !count.outletId && <button type="button" className="btn" onClick={() => run(() => exportBridgeWorkbook(id, count.name), 'Excel generado')}><FileSpreadsheet size={16} aria-hidden /> Excel para Maxirest</button>}
            {count.status === 'finalizado' && can('count.apply') && (
              <button type="button" className="btn btn-danger" onClick={async () => (await confirm({ title: 'Descartar conteo', message: 'El conteo quedará guardado como descartado y no modificará el stock.', danger: true, confirmLabel: 'Descartar' })) && run(() => discardCount(id))}>Descartar</button>
            )}
          </div>
        </section>
      )}

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar producto" />
        <Segmented label="Mostrar" value={show} onChange={setShow} options={[{ value: 'all', label: 'Todos' }, { value: 'pending', label: 'Pendientes' }, { value: 'done', label: 'Contados' }]} />
        <label className="check small"><input type="checkbox" checked={showExpected} onChange={(e) => setShowExpected(e.target.checked)} /> Ver esperado</label>
      </div>

      <GroupBar mode={g.mode} groups={g.groups} group={g.group} total={rows.length} onMode={g.setMode} onGroup={g.setGroup} />

      <div className="card">
        {rows.length === 0 ? (
          <EmptyState title="Nada para mostrar" />
        ) : (
          <>{shownRows.map((row, idx) => {
            const { i, p } = row;
            const diff = i.counted === undefined ? undefined : i.counted - i.expected;
            const gid = g.groupOf(row);
            const header = idx === 0 || g.groupOf(shownRows[idx - 1]) !== gid;
            return (
              <Fragment key={i.id}>
              {header && <div className="group-head">{g.labelOf(gid)} <span className="muted num">{g.groups.find((x) => x.id === gid)?.count}</span></div>}
              <div className={`count-item ${i.counted !== undefined ? 'done' : ''}`}>
                <div className="grow" style={{ minWidth: 160 }}>
                  <div className="list-title">{p!.name}</div>
                  <div className="list-sub">
                    {[lk.unit(p!.unitId), lk.location(p!.locationId)].filter(Boolean).join(' · ')}
                    {showExpected && <> · esperado <b className="num">{fmtNumber(i.expected)}</b></>}
                    {showExpected && diff !== undefined && diff !== 0 && <> · <b className={`num ${diff > 0 ? 'pos' : 'neg'}`}>{fmtSigned(diff)}</b></>}
                  </div>
                </div>
                {editable ? (
                  <div className="row">
                    {i.counted === undefined && showExpected && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCounted(i.id, i.expected)} aria-label={`Usar esperado para ${p!.name}`}>= {fmtNumber(i.expected)}</button>
                    )}
                    <Stepper label={p!.name} value={i.counted} onChange={(v) => setCounted(i.id, v)} />
                  </div>
                ) : (
                  <strong className="num">{fmtNumber(i.counted)}</strong>
                )}
              </div>
              </Fragment>
            );
          })}{sentinel}</>
        )}
      </div>
    </>
  );
}

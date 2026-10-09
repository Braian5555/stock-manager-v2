import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, CheckCheck, Copy, FileSpreadsheet, Forklift, Plus, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { db } from '../database/db';
import type { Transfer } from '../models';
import {
  MAXIREST_EXPORT_COLUMNS, MAXIREST_LABEL, maxirestRows, setMaxirestLoaded, transferCode, voidTransfer,
} from '../services/transferService';
import { menuLabel } from '../services/settingsService';
import { useLookups, useOutlets, useProducts, EMPTY } from '../hooks/useData';
import { useFeedback } from '../store/feedback';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { Modal } from '../components/ui/Modal';
import { Badge, EmptyState, Input, PageHeader, Segmented, Select } from '../components/ui';
import { OutletsPanel } from '../components/transfers/OutletsPanel';
import { OutletStockPanel } from '../components/transfers/OutletStockPanel';
import { downloadBlob, stamp } from '../exports/download';
import { toXlsx } from '../exports/writers';
import { fmtDateTime, fmtDay, fmtNumber } from '../utils/format';

type Tab = 'remitos' | 'stock' | 'puntos';
const MX_TONE: Record<Transfer['maxirest'], string> = { pendiente: 'warn', cargado: 'ok', no_aplica: '' };

import { useIncremental } from '../hooks/useIncremental';

export function TransfersPage() {
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'remitos';
  const setParam = (k: string, v?: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={menuLabel(settings, 'transfers')}
        subtitle="Mercadería que sale del Depósito Central a cada punto"
        actions={<Link to="/remitos/nuevo" className="btn btn-primary"><Plus size={18} aria-hidden /> Nuevo remito</Link>}
      />
      <div style={{ marginBottom: 12 }}>
        <Segmented<Tab> label="Sección" value={tab} onChange={(v) => setParam('tab', v === 'remitos' ? undefined : v)}
          options={[{ value: 'remitos', label: 'Remitos' }, { value: 'stock', label: 'Stock por punto' }, { value: 'puntos', label: 'Puntos' }]} />
      </div>
      {tab === 'remitos' && <TransferList viewId={params.get('ver') ?? undefined} setView={(id) => setParam('ver', id)} />}
      {tab === 'stock' && <OutletStockPanel />}
      {tab === 'puntos' && <OutletsPanel />}
    </>
  );
}

function TransferList({ viewId, setView }: { viewId?: string; setView: (id?: string) => void }) {
  const transfers = useLiveQuery(() => db.transfers.orderBy('number').reverse().toArray(), []) ?? EMPTY;
  const outlets = useOutlets();
  const outletName = useMemo(() => new Map(outlets.map((o) => [o.id, o.name])), [outlets]);
  const { run, confirm, notify } = useFeedback();
  const [outletId, setOutletId] = useState('');
  const [mx, setMx] = useState<'' | Transfer['maxirest']>('');
  const [month, setMonth] = useState('');

  const list = transfers.filter((t) => (!outletId || t.outletId === outletId) && (!mx || t.maxirest === mx) && (!month || t.date.startsWith(month)));
  const pending = transfers.filter((t) => t.maxirest === 'pendiente');
  const { visible: shownList, sentinel } = useIncremental(list, `${outletId}|${mx}|${month}`);

  const exportPending = async () => {
    const rows = await maxirestRows(pending);
    const blob = await toXlsx('Remitos para Maxirest', [{ title: 'Remitos', columns: MAXIREST_EXPORT_COLUMNS, rows }], [
      { name: 'Cómo cargarlo', lines: [
        'Remitos internos pendientes de cargar en Maxirest, una fila por insumo.',
        '"Transferencia": sale del depósito origen y entra al depósito destino.',
        '"Anulación": un remito que ya se había cargado y se anuló; hay que revertirlo en Maxirest.',
        'Cuando termines de cargarlos, volvé a Stock Manager y marcalos como "cargados en Maxirest".',
        'Formato genérico: se ajusta al formato de importación de Maxirest cuando se tenga un ejemplo real.',
      ] },
    ]);
    downloadBlob(blob, `remitos-para-maxirest_${stamp()}.xlsx`);
    const ok = await confirm({
      title: '¿Ya los cargaste en Maxirest?',
      message: `Cuando termines de cargar estos ${pending.length} remitos en Maxirest, marcalos como cargados para que no queden pendientes.`,
      confirmLabel: 'Sí, marcar como cargados',
      cancelLabel: 'Todavía no',
    });
    if (ok) {
      const n = await run(() => setMaxirestLoaded(pending.map((t) => t.id), true));
      if (n !== undefined) notify(`${n} remitos marcados como cargados en Maxirest.`);
    }
  };

  return (
    <>
      {pending.length > 0 && (
        <div className="card card-pad row wrap" style={{ marginBottom: 12, borderColor: 'var(--low)' }} role="status">
          <div className="grow">
            <b>{pending.length} {pending.length === 1 ? 'remito pendiente' : 'remitos pendientes'} de cargar en Maxirest</b>
            <div className="small muted">Maxirest no permite cargarlos automáticamente. Bajá el Excel, cargalos allá y marcalos como cargados.</div>
          </div>
          <button type="button" className="btn" onClick={() => setMx('pendiente')}>Ver pendientes</button>
          <button type="button" className="btn btn-primary" onClick={exportPending}><FileSpreadsheet size={18} aria-hidden /> Excel para Maxirest</button>
        </div>
      )}
      <div className="toolbar">
        <Select aria-label="Filtrar por punto" value={outletId} onChange={(e) => setOutletId(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Todos los puntos</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select aria-label="Filtrar por estado en Maxirest" value={mx} onChange={(e) => setMx(e.target.value as typeof mx)} style={{ maxWidth: 240 }}>
          <option value="">Todos</option>
          <option value="pendiente">Pendientes en Maxirest</option>
          <option value="cargado">Cargados en Maxirest</option>
        </Select>
        <Input type="month" aria-label="Filtrar por mes" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 180 }} />
      </div>
      <div className="card">
        {list.length === 0 ? (
          <EmptyState icon={<Forklift size={40} />} title={transfers.length ? 'No hay remitos con esos filtros' : 'Todavía no hay remitos'}>
            {!transfers.length && 'Cada vez que salga mercadería del depósito a un punto, hacé un remito: se resta del depósito y se suma al punto.'}
          </EmptyState>
        ) : (
          <div className="list">
            {shownList.map((t) => (
              <button key={t.id} type="button" className="list-item invoice-item" onClick={() => setView(t.id)} aria-label={`Remito ${transferCode(t.number)} a ${outletName.get(t.outletId) ?? ''}`}>
                <span className="stat-icon" aria-hidden><Forklift size={16} /></span>
                <div className="grow">
                  <div className="list-title truncate">{transferCode(t.number)} · {outletName.get(t.outletId) ?? '(punto eliminado)'}</div>
                  <div className="list-sub">{fmtDay(t.date)} · {t.items.length} {t.items.length === 1 ? 'producto' : 'productos'}{t.createdBy ? ` · ${t.createdBy.name}` : ''}</div>
                </div>
                <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                  {t.status === 'anulado' && <Badge tone="error">Anulado</Badge>}
                  {t.maxirest !== 'no_aplica' && <Badge tone={MX_TONE[t.maxirest]}>{t.maxirest === 'pendiente' ? 'Pendiente Maxirest' : 'En Maxirest'}</Badge>}
                </div>
              </button>
            ))}
            {sentinel}
          </div>
        )}
      </div>
      <TransferDetail id={viewId} onClose={() => setView()} />
    </>
  );
}

function TransferDetail({ id, onClose }: { id?: string; onClose: () => void }) {
  const tr = useLiveQuery(async () => (id ? ((await db.transfers.get(id)) ?? null) : undefined), [id]);
  const outlet = useLiveQuery(async () => (tr ? ((await db.outlets.get(tr.outletId)) ?? null) : undefined), [tr?.outletId]);
  const products = useProducts();
  const lk = useLookups();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const { can } = useSession();
  const { run, confirm, notify } = useFeedback();
  const navigate = useNavigate();
  const canEdit = can('transfers');

  const doVoid = async () => {
    if (!tr) return;
    const wasLoaded = tr.maxirest === 'cargado';
    const ok = await confirm({
      title: `Anular remito ${transferCode(tr.number)}`,
      message: <><p>La mercadería vuelve al Depósito Central y se descuenta de {outlet?.name ?? 'el punto'}. El remito queda guardado como anulado.</p>{wasLoaded && <p className="small">Como ya estaba cargado en Maxirest, va a quedar como pendiente para revertirlo allá.</p>}</>,
      danger: true,
      confirmLabel: 'Anular remito',
    });
    if (ok && (await run(() => voidTransfer(tr.id)))) notify(`Remito ${transferCode(tr.number)} anulado`);
  };

  return (
    <Modal open={!!id} wide title={tr ? `Remito ${transferCode(tr.number)}` : 'Remito'} onClose={onClose}
      footer={tr && canEdit && <>
        {tr.status === 'enviado' && <button type="button" className="btn btn-danger" onClick={doVoid}><Ban size={16} aria-hidden /> Anular</button>}
        <button type="button" className="btn" onClick={() => navigate(`/remitos/nuevo?copiar=${tr.id}`)}><Copy size={16} aria-hidden /> Repetir</button>
        {tr.maxirest === 'pendiente' && <button type="button" className="btn btn-primary" onClick={() => run(() => setMaxirestLoaded([tr.id], true), 'Marcado como cargado en Maxirest')}><CheckCheck size={16} aria-hidden /> Ya lo cargué en Maxirest</button>}
        {tr.maxirest === 'cargado' && <button type="button" className="btn" onClick={() => run(() => setMaxirestLoaded([tr.id], false), 'Vuelve a quedar pendiente')}><Undo2 size={16} aria-hidden /> Marcar pendiente</button>}
      </>}>
      {tr === null && <p>El remito ya no existe.</p>}
      {tr && (
        <div className="stack">
          <dl className="invoice-meta">
            <div><dt>Destino</dt><dd>{outlet?.name ?? '(punto eliminado)'}</dd></div>
            <div><dt>Fecha</dt><dd>{fmtDay(tr.date)}</dd></div>
            <div><dt>Hecho por</dt><dd>{tr.createdBy?.name ?? '—'}</dd></div>
            <div><dt>Maxirest</dt><dd><Badge tone={MX_TONE[tr.maxirest]}>{MAXIREST_LABEL[tr.maxirest]}</Badge></dd></div>
          </dl>
          {tr.status === 'anulado' && <p className="small"><Badge tone="error">Anulado</Badge> {fmtDateTime(tr.voidedAt)}{tr.voidedBy ? ` por ${tr.voidedBy.name}` : ''}</p>}
          {tr.maxirest === 'cargado' && tr.maxirestAt && <p className="small muted">Cargado en Maxirest el {fmtDateTime(tr.maxirestAt)}{tr.maxirestBy ? ` por ${tr.maxirestBy.name}` : ''}.</p>}
          {tr.maxirest === 'pendiente' && tr.status === 'anulado' && <p className="small">Falta revertirlo en Maxirest (ya se había cargado antes de anularlo).</p>}
          {tr.notes && <p className="small">{tr.notes}</p>}
          <div className="card">
            <div className="list">
              {tr.items.map((i) => {
                const p = byId.get(i.productId);
                return (
                  <div key={i.productId} className="list-item">
                    <div className="grow">
                      <div className="list-title truncate">{p?.name ?? '(producto eliminado)'}</div>
                      {p?.externalSystems?.maxirest && <div className="list-sub">Maxirest: {p.externalSystems.maxirest.code ?? p.externalSystems.maxirest.id}</div>}
                    </div>
                    <strong className="num">{fmtNumber(i.quantity)} {lk.unit(p?.unitId)}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

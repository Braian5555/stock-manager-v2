import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink, FlaskConical, Plug, PlugZap, RefreshCw, Settings2, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { db } from '../database/db';
import type { StockAuthority, SyncInterval } from '../models';
import { useIntegration } from '../hooks/useData';
import {
  disconnectIntegration, getCapabilities, INTEGRATION_STATUS_LABEL, MODE_LABEL, reconnectIntegration, syncNow, testConnection, updateIntegrationOptions,
} from '../integrations/integrationService';
import { CAPABILITIES, CAPABILITY_LABEL, type CapabilityMap } from '../integrations/core/types';
import type { StepResult } from '../integrations/core/syncEngine';
import { MAXIREST_OFFICIAL, MAXIREST_SOURCES, OFFICIAL_STATUS_LABEL } from '../integrations/maxirest/officialStatus';
import { getMockAdapter } from '../integrations/registry';
import { menuLabel } from '../services/settingsService';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { AUTHORITY_LABEL, ConnectionWizard, SyncResults } from '../components/integrations/ConnectionWizard';
import { MappingPanel } from '../components/integrations/MappingPanel';
import { ExcelBridgePanel } from '../components/integrations/ExcelBridgePanel';
import { SyncQueuePanel } from '../components/integrations/SyncQueuePanel';
import { Badge, Field, PageHeader, Segmented, Select } from '../components/ui';
import { fmtDateTime } from '../utils/format';

type Tab = 'estado' | 'vinculos' | 'excel' | 'cola';
const STATUS_TONE = { no_configurado: '', configurado: 'info', conectado: 'ok', error: 'error', desconectado: 'warn' } as const;

export function IntegrationsPage() {
  const settings = useSettings();
  const integ = useIntegration();
  const { run, confirm, notify } = useFeedback();
  const [wizard, setWizard] = useState(false);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((['estado', 'vinculos', 'excel', 'cola'] as Tab[]).find((t) => t === params.get('tab')) ?? 'estado');
  const [caps, setCaps] = useState<CapabilityMap | null>(null);
  const [results, setResults] = useState<StepResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const unlinked = useLiveQuery(async () => {
    const refs = await db.externalReferences.where({ system: 'maxirest', entityType: 'product' }).toArray();
    const linked = new Set((await db.products.toArray()).map((p) => p.externalSystems?.maxirest?.id).filter(Boolean));
    return refs.filter((r) => !linked.has(r.externalId)).length;
  }, []) ?? 0;

  useEffect(() => void getCapabilities().then(setCaps), [integ?.mode, integ?.status, integ?.gatewayUrl]);
  if (!integ) return null;

  const live = integ.mode === 'mock' || integ.mode === 'gateway';
  const connected = live && integ.status !== 'desconectado' && integ.status !== 'no_configurado';
  const mock = integ.mode === 'mock' ? getMockAdapter() : null;

  const doSync = async () => {
    setBusy(true);
    const r = await run(syncNow);
    setBusy(false);
    if (r) setResults(r);
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Desconectar Maxirest',
      message: <p>Se detiene la sincronización. <b>No se borran</b> productos, proveedores, movimientos, pedidos ni vínculos. La app sigue funcionando en modo independiente.</p>,
      confirmLabel: 'Desconectar',
    });
    if (ok) await run(disconnectIntegration, 'Maxirest desconectado');
  };

  return (
    <>
      <PageHeader title={menuLabel(settings, 'integrations')} subtitle="Stock Manager funciona completo sin integraciones. Conectar Maxirest es opcional." />
      {integ.mode === 'mock' && <div className="alert alert-demo" role="note" style={{ marginBottom: 12 }}><FlaskConical size={18} aria-hidden /> Modo demostración — Maxirest simulado. Ningún dato se envía ni se lee de Maxirest.</div>}

      <section className="card card-pad stack" aria-labelledby="mx">
        <div className="row between wrap">
          <h2 id="mx" className="row"><Plug size={20} aria-hidden /> Maxirest</h2>
          <div className="row"><Badge tone={STATUS_TONE[integ.status]}>{INTEGRATION_STATUS_LABEL[integ.status]}</Badge><Badge>{MODE_LABEL[integ.mode]}</Badge></div>
        </div>
        {integ.mode === 'disabled' && <p className="small muted">Ningún sistema externo conectado. Para conectar Maxirest (demostración, Excel o gateway) tocá “Configurar”.</p>}
        <dl className="kv" hidden={integ.mode === 'disabled'}>
          {live && <><dt>Fuente principal de stock</dt><dd>{AUTHORITY_LABEL[integ.stockAuthority]}</dd></>}
          <dt>Última sincronización</dt><dd>{fmtDateTime(integ.lastSyncAt)}</dd>
          {integ.gatewayUrl && <><dt>Gateway</dt><dd className="truncate">{integ.gatewayUrl}</dd></>}
          {integ.lastError && <><dt>Último error</dt><dd style={{ color: 'var(--out)' }}>{integ.lastError}</dd></>}
        </dl>
        {unlinked > 0 && (
          <button type="button" className="alert alert-warn" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setTab('vinculos')}>
            {unlinked} {unlinked === 1 ? 'insumo de Maxirest no está vinculado' : 'insumos de Maxirest no están vinculados'}. <u>Vincular</u>
          </button>
        )}
        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={() => setWizard(true)}><Settings2 size={18} aria-hidden /> Configurar</button>
          {live && <button type="button" className="btn" disabled={busy || integ.status === 'desconectado'} onClick={() => run(testConnection).then((r) => r && notify(r.message, { tone: r.ok ? 'info' : 'error' }))}><PlugZap size={18} aria-hidden /> Probar conexión</button>}
          {live && <button type="button" className="btn" disabled={busy || !connected} onClick={doSync}><RefreshCw size={18} className={busy ? 'spin' : ''} aria-hidden /> Sincronizar ahora</button>}
          {live && integ.status !== 'desconectado' && <button type="button" className="btn btn-danger" onClick={disconnect}><Unplug size={18} aria-hidden /> Desconectar</button>}
          {integ.status === 'desconectado' && <button type="button" className="btn" onClick={() => run(reconnectIntegration, 'Integración reactivada')}>Reconectar</button>}
        </div>
        {results && <SyncResults results={results} />}
        {live && (
          <div className="form-grid cols-2">
            <Field label="Sistema principal de stock">
              <Select value={integ.stockAuthority} onChange={(e) => run(() => updateIntegrationOptions({ stockAuthority: e.target.value as StockAuthority }))}>
                {(Object.keys(AUTHORITY_LABEL) as StockAuthority[]).map((a) => <option key={a} value={a}>{AUTHORITY_LABEL[a]}</option>)}
              </Select>
            </Field>
            <Field label="Sincronización automática" hint="mientras la app está abierta">
              <Select value={integ.syncInterval} onChange={(e) => run(() => updateIntegrationOptions({ syncInterval: e.target.value as SyncInterval }))}>
                <option value="manual">Manual</option><option value="15">Cada 15 minutos</option><option value="30">Cada 30 minutos</option><option value="60">Cada hora</option>
              </Select>
            </Field>
          </div>
        )}
      </section>

      <div style={{ margin: '16px 0 12px' }}>
        <Segmented<Tab> label="Secciones" value={tab} onChange={setTab} options={[{ value: 'estado', label: 'Qué está disponible' }, { value: 'vinculos', label: 'Vínculos' }, { value: 'excel', label: 'Excel Bridge' }, { value: 'cola', label: 'Cola de sincronización' }]} />
      </div>

      {tab === 'estado' && (
        <section className="card" aria-label="Estado de la integración">
          <div className="card-body stack">
            <p className="small">
              <b>Estado real:</b> Maxirest no publica una API documentada para stock, insumos ni inventarios (revisión del 06/10/2026).
              Las integraciones oficiales listadas son de delivery, salón, cobros y fidelización. Hoy el único camino disponible es el <b>Excel Bridge</b> (manual).
            </p>
          </div>
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Operación</th><th>Maxirest oficial</th><th>Esta conexión</th></tr></thead>
              <tbody>
                {CAPABILITIES.map((c) => (
                  <tr key={c}>
                    <td className="cell-title">{CAPABILITY_LABEL[c]}<div className="small muted" style={{ fontWeight: 400 }}>{MAXIREST_OFFICIAL[c].note}</div></td>
                    <td data-label="Maxirest oficial"><Badge tone={MAXIREST_OFFICIAL[c].status === 'manual_excel' ? 'info' : 'warn'}>{OFFICIAL_STATUS_LABEL[MAXIREST_OFFICIAL[c].status]}</Badge></td>
                    <td data-label="Esta conexión">
                      {!caps ? <span className="muted">—</span> : caps[c] === 'supported' ? <Badge tone="ok">{integ.mode === 'mock' ? 'Simulado' : 'Disponible'}</Badge> : caps[c] === 'pending_enablement' ? <Badge tone="warn">Pendiente</Badge> : <Badge>NOT_SUPPORTED</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body small">
            <b>Fuentes oficiales consultadas:</b>
            <ul>{MAXIREST_SOURCES.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label} <ExternalLink size={12} aria-hidden /></a></li>)}</ul>
          </div>
        </section>
      )}
      {tab === 'vinculos' && <section className="card card-pad"><MappingPanel /></section>}
      {tab === 'excel' && <section className="card card-pad"><ExcelBridgePanel onImported={() => setTab('vinculos')} /></section>}
      {tab === 'cola' && <section className="card card-pad"><SyncQueuePanel connected={connected} /></section>}

      {mock && (
        <section className="card card-pad stack" style={{ marginTop: 16 }} aria-labelledby="demo">
          <h2 id="demo" className="row"><FlaskConical size={18} aria-hidden /> Herramientas de la demostración</h2>
          <p className="small muted">Sólo afectan al Maxirest simulado. Sirven para probar errores, reintentos y conciliación.</p>
          <div className="row wrap">
            <label className="check"><input type="checkbox" defaultChecked={mock.simulatedFailure} onChange={(e) => { mock.setSimulatedFailure(e.target.checked); notify(e.target.checked ? 'Maxirest simulado: fuera de servicio' : 'Maxirest simulado: en línea'); }} /> Simular que Maxirest no responde</label>
            <button type="button" className="btn btn-sm" onClick={() => { mock.simulateConsumption('I1001', 6); notify('Se simuló un consumo de 6 unidades de “Agua mineral 500 ml” en Maxirest.'); }}>Simular consumo en Maxirest</button>
            <button type="button" className="btn btn-sm" onClick={() => { mock.reset(); notify('Demostración reiniciada'); }}>Reiniciar datos simulados</button>
          </div>
        </section>
      )}
      <ConnectionWizard open={wizard} onClose={(goto) => { setWizard(false); if (goto) setTab(goto); }} />
    </>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, CircleSlash, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db } from '../../database/db';
import type { IntegrationMode, StockAuthority, SyncInterval } from '../../models';
import { configureIntegration, getIntegration, syncNow, testConnection } from '../../integrations/integrationService';
import type { StepResult } from '../../integrations/core/syncEngine';
import type { ConnectionResult } from '../../integrations/core/types';
import { useFeedback } from '../../store/feedback';
import { Modal } from '../ui/Modal';
import { Field, Input, Select } from '../ui';
import { MappingPanel } from './MappingPanel';

const STEPS = ['Configurar', 'Probar', 'Importar', 'Resumen', 'Mapear', 'Confirmar', 'Sincronizar'];

export const AUTHORITY_LABEL: Record<StockAuthority, string> = {
  maxirest: 'Maxirest es la fuente principal (recomendado)',
  stockmanager: 'Stock Manager es la fuente principal',
  manual: 'Manual: sólo comparar, nunca ajustar solo',
};

export function SyncResults({ results }: { results: StepResult[] }) {
  return (
    <div>
      {results.map((r) => (
        <div key={r.key} className="result-line">
          {r.status === 'ok' ? <CheckCircle2 size={18} className="pos" aria-hidden /> : r.status === 'not_supported' ? <CircleSlash size={18} className="muted" aria-hidden /> : <XCircle size={18} className="neg" aria-hidden />}
          <span className="grow">{r.label} {r.status === 'ok' ? '✓' : ''}</span>
          <span className="small muted">{r.status === 'ok' ? `${r.count ?? 0} registros` : r.message}</span>
        </div>
      ))}
    </div>
  );
}

export function ConnectionWizard({ open, onClose }: { open: boolean; onClose: (goto?: 'excel') => void }) {
  const { run, notify } = useFeedback();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<IntegrationMode>('mock');
  const [url, setUrl] = useState(import.meta.env.VITE_DEFAULT_GATEWAY_URL ?? '');
  const [authority, setAuthority] = useState<StockAuthority>('maxirest');
  const [interval, setIntervalValue] = useState<SyncInterval>('manual');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<ConnectionResult | null>(null);
  const [results, setResults] = useState<StepResult[]>([]);
  const counts = useLiveQuery(async () => {
    const all = await db.externalReferences.where('[system+entityType]').between(['maxirest', ''], ['maxirest', '￿']).toArray();
    const by = (t: string) => all.filter((r) => r.entityType === t).length;
    return { product: by('product'), category: by('category'), location: by('location'), unit: by('unit') };
  }, [step]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setTest(null);
    setResults([]);
    void getIntegration().then((i) => {
      setMode(i.mode === 'disabled' ? 'mock' : i.mode);
      setUrl(i.gatewayUrl ?? import.meta.env.VITE_DEFAULT_GATEWAY_URL ?? '');
      setAuthority(i.stockAuthority);
      setIntervalValue(i.syncInterval);
    });
  }, [open]);

  const busyRun = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try {
      return await run(fn);
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (step === 0) {
      const ok = await busyRun(() => configureIntegration({ mode, gatewayUrl: url, stockAuthority: authority, syncInterval: interval }).then(() => true));
      if (!ok) return;
      if (mode === 'excel') {
        notify('Excel Bridge activado. Importá el Excel exportado de Maxirest.');
        return onClose('excel');
      }
      setStep(1);
      const r = await busyRun(testConnection);
      if (r) setTest(r);
      return;
    }
    if (step === 1) {
      setStep(2);
      const r = await busyRun(syncNow);
      if (r) setResults(r);
      return;
    }
    if (step === 5) {
      setStep(6);
      const r = await busyRun(syncNow);
      if (r) setResults(r);
      return;
    }
    if (step === 6) return onClose();
    setStep(step + 1);
  };

  const canNext = !busy && (step !== 1 || test?.ok) && (step !== 0 || mode !== 'gateway' || url.trim());

  return (
    <Modal open={open} wide title="Conectar Maxirest" onClose={() => onClose()}
      footer={
        <>
          {step > 0 && step < 6 && <button type="button" className="btn" disabled={busy} onClick={() => setStep(step === 1 ? 0 : step - 1)}>Atrás</button>}
          <button type="button" className="btn btn-primary" disabled={!canNext} onClick={next}>
            {busy && <Loader2 size={16} className="spin" aria-hidden />}
            {step === 6 ? 'Finalizar' : step === 5 ? 'Confirmar y sincronizar' : 'Continuar'}
          </button>
        </>
      }>
      <ol className="steps" aria-label="Pasos">
        {STEPS.map((s, i) => <li key={s} style={{ listStyle: 'none' }}><span className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>{i + 1}. {s}</span></li>)}
      </ol>

      {step === 0 && (
        <div className="stack">
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small muted" style={{ marginBottom: 6 }}>¿Cómo querés conectar?</legend>
            <label className="check card card-pad"><input type="radio" name="mode" checked={mode === 'mock'} onChange={() => setMode('mock')} />
              <span><b>Demostración — Maxirest simulado</b><br /><span className="small muted">Para probar el flujo completo. No se conecta a Maxirest.</span></span></label>
            <label className="check card card-pad"><input type="radio" name="mode" checked={mode === 'excel'} onChange={() => setMode('excel')} />
              <span><b>Excel Bridge (manual)</b><br /><span className="small muted">Exportás el inventario desde Maxirest a Excel y lo importás acá. Disponible hoy.</span></span></label>
            <label className="check card card-pad"><input type="radio" name="mode" checked={mode === 'gateway'} onChange={() => setMode('gateway')} />
              <span><b>Maxirest vía Integration Gateway</b><br /><span className="small muted">Requiere un backend propio y que Maxirest habilite un acceso oficial. Ver docs/maxirest.md.</span></span></label>
          </fieldset>
          {mode === 'gateway' && (
            <Field label="URL del gateway" hint="HTTPS, sin credenciales">
              <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mi-gateway.ejemplo.com" />
            </Field>
          )}
          {mode !== 'excel' && (
            <div className="form-grid cols-2">
              <Field label="Sistema principal de stock">
                <Select value={authority} onChange={(e) => setAuthority(e.target.value as StockAuthority)}>
                  {(Object.keys(AUTHORITY_LABEL) as StockAuthority[]).map((a) => <option key={a} value={a}>{AUTHORITY_LABEL[a]}</option>)}
                </Select>
              </Field>
              <Field label="Sincronización automática" hint="sólo con la app abierta">
                <Select value={interval} onChange={(e) => setIntervalValue(e.target.value as SyncInterval)}>
                  <option value="manual">Manual</option><option value="15">Cada 15 minutos</option><option value="30">Cada 30 minutos</option><option value="60">Cada hora</option>
                </Select>
              </Field>
            </div>
          )}
          <p className="small muted">Nunca se guardan contraseñas, tokens ni claves en esta app. Si la conexión necesita credenciales, se configuran sólo en el gateway.</p>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          {busy && <p className="row"><Loader2 size={18} className="spin" aria-hidden /> Probando conexión…</p>}
          {test && <div className={`alert ${test.ok ? 'alert-ok' : 'alert-danger'}`}>{test.ok ? <CheckCircle2 size={18} aria-hidden /> : <XCircle size={18} aria-hidden />}<span>{test.message}</span></div>}
          {test && !test.ok && <button type="button" className="btn" onClick={() => busyRun(testConnection).then((r) => r && setTest(r))}>Reintentar</button>}
        </div>
      )}

      {step === 2 && (busy ? <p className="row"><Loader2 size={18} className="spin" aria-hidden /> Importando información disponible…</p> : <SyncResults results={results} />)}

      {step === 3 && counts && (
        <div className="grid grid-stats">
          <div className="card stat"><span className="stat-value">{counts.product}</span><span className="stat-label">insumos</span></div>
          <div className="card stat"><span className="stat-value">{counts.category}</span><span className="stat-label">rubros</span></div>
          <div className="card stat"><span className="stat-value">{counts.location}</span><span className="stat-label">depósitos</span></div>
          <div className="card stat"><span className="stat-value">{counts.unit}</span><span className="stat-label">unidades</span></div>
        </div>
      )}

      {step === 4 && <MappingPanel />}

      {step === 5 && (
        <div className="stack">
          <p>Se va a sincronizar con estas reglas:</p>
          <ul className="small">
            <li><b>{AUTHORITY_LABEL[authority]}</b>.</li>
            {authority === 'maxirest' && <li>El stock de los productos vinculados se alineará al de Maxirest (queda registrado como movimiento).</li>}
            {authority === 'stockmanager' && <li>Los movimientos de Maxirest se aplicarán a los productos vinculados, sin duplicarse.</li>}
            {authority === 'manual' && <li>No se modificará ningún stock: sólo se mostrarán diferencias en Conciliación.</li>}
            <li>Los ajustes hacia Maxirest siempre piden confirmación.</li>
            <li>Los productos no vinculados no se tocan y no se crean duplicados.</li>
          </ul>
        </div>
      )}

      {step === 6 && (busy ? <p className="row"><Loader2 size={18} className="spin" aria-hidden /> Sincronizando…</p> : <SyncResults results={results} />)}
    </Modal>
  );
}

import { AlertTriangle, CheckCircle2, ClipboardCopy, Download, Info, RefreshCw, Trash2, Wrench, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCloud } from '../cloud/cloudService';
import { downloadBlob, stamp } from '../exports/download';
import {
  clearErrorLog, countProducts, fixStockMismatches, reportToText, runDiagnostics, type Check, type DiagnosticReport, type Level,
} from '../services/diagnosticsService';
import { useFeedback } from '../store/feedback';
import { PageHeader } from '../components/ui';
import { fmtTime } from '../utils/format';

const ICON: Record<Level, typeof CheckCircle2> = { ok: CheckCircle2, info: Info, warn: AlertTriangle, error: XCircle };
const ORDER: Level[] = ['error', 'warn', 'info', 'ok'];

/**
 * Diagnóstico: la app se revisa sola (datos, nube, errores registrados) y arma un informe
 * para pegarle a Claude, que corrige lo que falte en el código.
 */
export function DiagnosticsPage() {
  const cloud = useCloud();
  const { run, notify, confirm } = useFeedback();
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const navigate = useNavigate();

  // Estado de la nube al momento de revisar (no el de cuando se abrió la pantalla).
  const cloudRef = useRef(cloud);
  cloudRef.current = cloud;
  const prev = useRef<DiagnosticReport | null>(null);

  const check = useCallback(async (manual = false) => {
    setBusy(true);
    const c = cloudRef.current;
    const started = Date.now();
    const r = await run(() =>
      runDiagnostics({
        phase: c.phase,
        provider: c.provider,
        workspace: c.workspace?.name,
        syncState: c.status.state,
        pending: c.status.pending,
        lastSyncAt: c.status.lastSyncAt,
        error: c.status.error ?? c.error,
      }),
    );
    // La revisión tarda milisegundos: una pausa corta para que se note que se hizo.
    await new Promise((res) => setTimeout(res, Math.max(0, 600 - (Date.now() - started))));
    setBusy(false);
    if (!r) return;
    if (manual) notify(compare(prev.current, r));
    prev.current = r;
    setReport(r);
    setText(reportToText(r));
  }, [run, notify]);

  useEffect(() => {
    void check();
  }, [check]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Informe copiado. Pegalo en el chat con Claude.');
    } catch {
      // Sin permiso de portapapeles: se selecciona el texto para copiarlo a mano.
      const el = document.getElementById('diag-text') as HTMLTextAreaElement | null;
      el?.focus();
      el?.select();
      notify('Seleccioné el informe: copialo con Ctrl+C (o mantené apretado en el celular).');
    }
  };

  const download = () => downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `diagnostico-stock-manager-${stamp()}.md`);

  const fix = async (c: Check) => {
    if (c.fix === 'count-negatives' && c.productIds?.length) {
      const count = await run(() => countProducts(c.productIds!, 'Conteo de productos en negativo'), 'Conteo armado: cargá cuánto hay de cada uno');
      if (count) navigate(`/conteo/${count.id}`);
      return;
    }
    if (c.fix !== 'recompute-stock') return;
    const yes = await confirm({
      title: 'Recalcular stock',
      message: `Se vuelve a calcular el stock de ${c.count} productos sumando su historial de movimientos. No se borra nada.`,
      confirmLabel: 'Recalcular',
    });
    if (!yes) return;
    const n = await run(fixStockMismatches);
    if (n !== undefined) {
      notify(`Stock recalculado en ${n} productos`);
      void check(true);
    }
  };

  const clearLog = async () => {
    const yes = await confirm({ title: 'Borrar registro de errores', message: 'Se borra la lista de errores guardada en este dispositivo (no toca tus datos).', confirmLabel: 'Borrar' });
    if (!yes) return;
    clearErrorLog();
    void check(true);
  };

  const n = (l: Level) => report?.checks.filter((c) => c.level === l).length ?? 0;
  const sorted = report ? [...report.checks].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level)) : [];

  return (
    <div className="stack diag">
      <PageHeader
        title="Diagnóstico"
        subtitle="La app revisa sus datos, la nube y los errores que tuvo. Copiá el informe y pegáselo a Claude para que corrija lo que falte."
        actions={<button type="button" className="btn btn-sm" onClick={() => check(true)} disabled={busy}><RefreshCw size={16} aria-hidden className={busy ? 'spin' : ''} /> {busy ? 'Revisando…' : 'Revisar de nuevo'}</button>}
      />

      {report && (
        <div className="card card-body diag-head" aria-busy={busy} style={busy ? { opacity: 0.55 } : undefined}>
          <div className="diag-score" aria-live="polite">
            {n('error') ? <XCircle size={28} aria-hidden className="diag-error" /> : n('warn') ? <AlertTriangle size={28} aria-hidden className="diag-warn" /> : <CheckCircle2 size={28} aria-hidden className="diag-ok" />}
            <div>
              <strong>{n('error') ? `${n('error')} ${n('error') === 1 ? 'problema' : 'problemas'} para corregir` : n('warn') ? `${n('warn')} ${n('warn') === 1 ? 'aviso' : 'avisos'}` : 'Todo en orden'}</strong>
              <div className="small muted">
                {n('ok')} revisiones en orden{n('info') ? ` · ${n('info')} notas` : ''} · v{report.version} · revisado a las {fmtTime(report.at)}
              </div>
            </div>
          </div>
          <div className="row wrap">
            <button type="button" className="btn btn-primary" onClick={copy}><ClipboardCopy size={18} aria-hidden /> Copiar informe para Claude</button>
            <button type="button" className="btn" onClick={download}><Download size={18} aria-hidden /> Descargar</button>
          </div>
        </div>
      )}

      {!report && busy && <p className="muted">Revisando…</p>}

      <div className="list card">
        {sorted.map((c) => {
          const Icon = ICON[c.level];
          return (
            <details key={c.id} className={`diag-item diag-${c.level}`} open={c.level === 'error'}>
              <summary className="list-item">
                <Icon size={20} aria-hidden className={`diag-${c.level}`} />
                <span className="grow">
                  <span className="list-title">{c.title}</span>
                  <span className="list-sub" style={{ display: 'block' }}>{c.summary}</span>
                </span>
              </summary>
              {(c.items?.length || c.fix || c.id === 'app-errors') && (
                <div className="diag-body">
                  {c.items?.length ? (
                    <ul className="small">
                      {c.items.map((i, k) => <li key={k}>{i}</li>)}
                      {c.count && c.count > c.items.length ? <li className="muted">… y {c.count - c.items.length} más</li> : null}
                    </ul>
                  ) : null}
                  <div className="row wrap">
                    {c.fix && <button type="button" className="btn btn-sm" onClick={() => fix(c)}><Wrench size={15} aria-hidden /> {c.fix === 'count-negatives' ? 'Contar estos productos' : 'Corregir ahora'}</button>}
                    {c.id === 'app-errors' && report?.errors.length ? <button type="button" className="btn btn-sm btn-ghost" onClick={clearLog}><Trash2 size={15} aria-hidden /> Borrar registro</button> : null}
                  </div>
                </div>
              )}
            </details>
          );
        })}
      </div>

      {report && (
        <details className="card">
          <summary className="list-item"><span className="grow list-title">Ver el informe completo</span></summary>
          <div className="card-body">
            <textarea id="diag-text" className="input diag-text" readOnly value={text} rows={14} aria-label="Informe de diagnóstico" />
          </div>
        </details>
      )}
    </div>
  );
}

/** Qué cambió desde la revisión anterior, para el aviso de "Revisar de nuevo". */
function compare(before: DiagnosticReport | null, after: DiagnosticReport): string {
  const bad = (r: DiagnosticReport) => r.checks.filter((c) => c.level === 'error' || c.level === 'warn');
  const now = bad(after);
  if (!before) return now.length ? `Revisión hecha: ${now.length} para revisar` : 'Revisión hecha: todo en orden';
  const was = new Map(bad(before).map((c) => [c.id, c]));
  const fixed = bad(before).filter((c) => !now.some((x) => x.id === c.id)).length;
  const added = now.filter((c) => !was.has(c.id)).length;
  const moved = now.filter((c) => was.has(c.id) && was.get(c.id)!.count !== c.count).map((c) => `${c.title}: ${was.get(c.id)!.count ?? '?'} → ${c.count ?? '?'}`);
  const parts = [fixed && `${fixed} resueltos`, added && `${added} nuevos`, ...moved].filter(Boolean);
  return parts.length ? `Revisión hecha · ${parts.join(' · ')}` : 'Revisión hecha: sin cambios desde la anterior';
}

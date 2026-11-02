import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Circle, Clock, Copy, KeyRound, ListChecks, PlugZap, RefreshCw, Server, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Integration } from '../../models';
import { connectMaxirest, syncNow, testConnection } from '../../integrations/integrationService';
import { CAPABILITIES, CAPABILITY_LABEL, type CapabilityMap } from '../../integrations/core/types';
import { maxirestReadiness } from '../../integrations/maxirest/readiness';
import type { StepResult } from '../../integrations/core/syncEngine';
import { useFeedback } from '../../store/feedback';
import { useSettings } from '../../store/settings';
import { Input } from '../ui';

/** Nombres sugeridos para los datos de acceso que entregue Maxirest (se cargan en Cloudflare, nunca en la app). */
export const MAXIREST_SECRET_NAMES = ['MAXIREST_API_URL', 'MAXIREST_API_KEY', 'MAXIREST_USER', 'MAXIREST_PASSWORD'];

const KEYS_HELP = `Cómo cargar los datos de acceso de Maxirest (cuando te los den):
1. Entrá a dash.cloudflare.com → Workers & Pages → tu servidor de Stock Manager.
2. Settings → Variables and Secrets → Add.
3. Tipo "Secret". Cargá cada dato con estos nombres (los que te hayan dado):
   ${MAXIREST_SECRET_NAMES.join('\n   ')}
4. Deploy. Después tocá "Probar de nuevo" en Stock Manager.
Nunca pegues esos datos en la app ni en un chat.`;

type State = 'done' | 'waiting' | 'error' | 'todo';
const STATE_ICON: Record<State, typeof CheckCircle2> = { done: CheckCircle2, waiting: Clock, error: XCircle, todo: Circle };

/**
 * Integraciones → Maxirest en tres pasos claros: servidor (el mismo de la IA), permiso de Maxirest
 * y datos listos. Sin URLs ni términos técnicos salvo que se pidan.
 */
export function MaxirestConnectCard({ integ, caps, onCaps, onReview, onResults }: {
  integ: Integration;
  caps: CapabilityMap | null;
  onCaps: () => void;
  onReview: () => void;
  onResults: (r: StepResult[]) => void;
}) {
  const settings = useSettings();
  const { run, notify } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState(false);
  const [url, setUrl] = useState('');
  const ready = useLiveQuery(() => maxirestReadiness(), []);

  const server = integ.mode === 'gateway' ? integ.gatewayUrl : undefined;
  const serverUrl = server ?? settings.aiReaderUrl;
  const connected = integ.mode === 'gateway' && integ.status === 'conectado';
  const enabled = caps ? CAPABILITIES.filter((c) => caps[c] === 'supported') : [];

  const connect = async (target = serverUrl) => {
    setBusy(true);
    const r = await run(() => (integ.mode === 'gateway' && target === server ? testConnection() : connectMaxirest(target)));
    setBusy(false);
    onCaps();
    if (r) notify(r.ok ? 'Servidor conectado' : r.message, { tone: r.ok ? 'info' : 'error' });
    if (r?.ok) setOther(false);
  };
  const sync = async () => {
    setBusy(true);
    const r = await run(syncNow);
    setBusy(false);
    if (r) onResults(r);
  };

  const s1: State = connected ? 'done' : integ.mode === 'gateway' && integ.status === 'error' ? 'error' : 'todo';
  const s2: State = !connected ? 'todo' : enabled.length ? 'done' : 'waiting';
  const warns = ready?.checks.filter((c) => c.level === 'warn').length ?? 0;
  const s3: State = !ready ? 'todo' : warns ? 'todo' : 'done';

  return (
    <section className="card card-pad stack mx-connect" aria-labelledby="mx-connect">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="mx-connect" className="row"><PlugZap size={20} aria-hidden /> Conectar Maxirest</h2>
        <p className="small muted" style={{ margin: 0 }}>Tres pasos. Cuando estén los tres en verde, el stock de Maxirest se actualiza solo con el de Stock Manager.</p>
      </div>
      <ol className="mx-steps">
        <Step n={1} state={s1} icon={<Server size={18} aria-hidden />} title="Servidor de conexión"
          text={!serverUrl ? 'Maxirest usa el mismo servidor que la IA, y todavía no está configurado.' : connected ? 'Conectado. Es el mismo servidor de la IA.' : integ.status === 'error' && integ.mode === 'gateway' ? `No responde: ${integ.lastError ?? 'revisá que esté publicado el código nuevo en Cloudflare.'}` : 'Se usa el mismo servidor de la IA. Tocá Conectar.'}>
          <div className="row wrap" style={{ gap: 8 }}>
            {!serverUrl
              ? <Link to="/configuracion/ia" className="btn btn-primary">Activar la IA primero</Link>
              : <button type="button" className={connected ? 'btn' : 'btn btn-primary'} disabled={busy} onClick={() => void connect()}>{busy ? <RefreshCw size={16} className="spin" aria-hidden /> : <PlugZap size={16} aria-hidden />} {connected ? 'Probar de nuevo' : 'Conectar'}</button>}
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={other} onClick={() => { setOther(!other); setUrl(server ?? ''); }}>Usar otro servidor</button>
          </div>
          {other && (
            <form className="row wrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void connect(url); }}>
              <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://….workers.dev" aria-label="Dirección del servidor" style={{ flex: '1 1 220px' }} />
              <button type="submit" className="btn" disabled={busy || !url.trim()}>Conectar</button>
            </form>
          )}
        </Step>

        <Step n={2} state={s2} icon={<KeyRound size={18} aria-hidden />} title="Permiso de Maxirest"
          text={!connected ? 'Primero conectá el servidor.' : enabled.length ? `Habilitado: ${enabled.map((c) => CAPABILITY_LABEL[c].toLowerCase()).join(', ')}.` : 'Esperando que Maxirest habilite su API. Cuando te den los datos de acceso, cargalos en Cloudflare (no en la app) y tocá "Probar de nuevo".'}>
          {connected && !enabled.length && (
            <details className="mx-help">
              <summary>Cómo cargar los datos de acceso</summary>
              <pre className="small">{KEYS_HELP}</pre>
              <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(KEYS_HELP).then(() => notify('Instrucciones copiadas'))}><Copy size={15} aria-hidden /> Copiar instrucciones</button>
            </details>
          )}
          {enabled.length > 0 && <button type="button" className="btn btn-primary" disabled={busy} onClick={sync}><RefreshCw size={16} className={busy ? 'spin' : ''} aria-hidden /> Sincronizar ahora</button>}
        </Step>

        <Step n={3} state={s3} icon={<ListChecks size={18} aria-hidden />} title="Datos listos"
          text={!ready ? 'Revisando…' : warns ? `${ready.withCode} de ${ready.products} productos con código · ${warns} ${warns === 1 ? 'cosa para corregir' : 'cosas para corregir'}.` : `Todo listo: ${ready.withCode} productos con código.`}>
          <button type="button" className="btn btn-sm" onClick={onReview}>{warns ? 'Revisar y completar' : 'Ver detalle'}</button>
        </Step>
      </ol>
      {connected && !enabled.length && <p className="small muted" style={{ margin: 0 }}>Mientras tanto, el inventario se pasa con el Excel (pestaña “Excel”).</p>}
    </section>
  );
}

function Step({ n, state, icon, title, text, children }: { n: number; state: State; icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  const Icon = STATE_ICON[state];
  const label = { done: 'listo', waiting: 'esperando', error: 'con error', todo: 'pendiente' }[state];
  return (
    <li className={`mx-step mx-step-${state}`} aria-label={`Paso ${n}: ${title} (${label})`}>
      <span className="mx-step-mark" aria-hidden><Icon size={22} /></span>
      <div className="grow stack" style={{ gap: 6, minWidth: 0 }}>
        <b className="row" style={{ gap: 6 }}>{icon} {n}. {title}</b>
        <span className="small muted">{text}</span>
        {children}
      </div>
    </li>
  );
}

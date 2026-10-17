import { CheckCircle2, Copy, PlugZap, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/cloudService';
import { testReader } from '../services/invoiceAI';
import { updateSettings } from '../services/settingsService';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Field, Input, PageHeader } from './ui';

/**
 * Configuración → Lectura de facturas con IA: dirección del servidor de Cloudflare que guarda la
 * clave de la IA (Gemini de Google, gratis; o Claude). Se guarda en la configuración del negocio (llega a todos los dispositivos).
 */
export function AIReaderSection() {
  const settings = useSettings();
  const cloud = useCloud();
  const { run, notify } = useFeedback();
  const [url, setUrl] = useState(settings.aiReaderUrl ?? '');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => setUrl(settings.aiReaderUrl ?? ''), [settings.aiReaderUrl]);

  const clean = url.trim().replace(/\/+$/, '');
  const valid = !clean || /^https:\/\/[a-z0-9.-]+(\/[\w./-]*)?$/i.test(clean);

  const test = async (target = clean) => {
    if (!target) return;
    setTesting(true);
    try {
      const r = await testReader(target);
      setStatus(r.configured
        ? { ok: true, text: `Conectado con ${r.provider === 'anthropic' ? 'Claude (Anthropic)' : 'Gemini (Google)'}: ya podés leer facturas.` }
        : { ok: false, text: 'El servidor responde, pero falta cargar la clave (secreto GEMINI_API_KEY en Cloudflare).' });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : 'No se pudo conectar.' });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!valid) return notify('La dirección tiene que empezar con https://', { tone: 'error' });
    const ok = await run(() => updateSettings({ aiReaderUrl: clean || undefined }).then(() => true), clean ? 'Dirección guardada' : 'Lectura con IA desactivada');
    if (ok && clean) void test(clean);
  };

  return (
    <div className="stack">
      <PageHeader title="Lectura con IA" subtitle="Leer facturas desde la foto y usar el Asistente IA (opcional)." />
      <section className="card card-pad stack">
        <h2 className="row"><Sparkles size={18} aria-hidden /> Servidor de lectura</h2>
        <p className="small muted">
          En Facturas, “Leer con IA” manda la foto a tu servidor de Cloudflare, que la lee y devuelve los productos para revisar. El mismo servidor activa el <b>Asistente IA</b>: cada persona le escribe o dicta lo que necesita, según los permisos de su perfil.
          Usa Gemini de Google con su plan gratis (tiene un límite de lecturas por día, y en ese plan Google puede usar lo que se envía para mejorar sus productos). La clave queda guardada en Cloudflare: nunca está en la app ni en los celulares.
        </p>
        {cloud.phase !== 'linked' && <div className="alert"><span>Este dispositivo no está conectado a la nube: hace falta para leer facturas (Cuenta y nube).</span></div>}
        <Field label="Dirección del servidor" hint="la que te da Cloudflare, termina en .workers.dev">
          <Input value={url} onChange={(e) => { setUrl(e.target.value); setStatus(null); }} placeholder="https://stock-manager-ia.tu-usuario.workers.dev" inputMode="url" autoComplete="off" spellCheck={false} />
        </Field>
        {!valid && <p className="small" role="alert" style={{ color: 'var(--crit)', margin: 0 }}>La dirección tiene que empezar con https://</p>}
        <div className="row wrap">
          <button type="button" className="btn btn-primary" disabled={!valid || clean === (settings.aiReaderUrl ?? '')} onClick={() => void save()}>Guardar</button>
          <button type="button" className="btn" disabled={!clean || !valid || testing} onClick={() => void test()}><PlugZap size={16} aria-hidden /> {testing ? 'Probando…' : 'Probar conexión'}</button>
        </div>
        {status && (
          <p className="row small" role="status" style={{ margin: 0, color: status.ok ? 'var(--ok)' : 'var(--crit)' }}>
            {status.ok ? <CheckCircle2 size={16} aria-hidden /> : <XCircle size={16} aria-hidden />} {status.text}
          </p>
        )}
      </section>
      <section className="card card-pad stack">
        <h3 style={{ margin: 0 }}>Cómo se instala (una sola vez)</h3>
        <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
          <li>En <b>aistudio.google.com</b>, con tu cuenta de Google, tocá <b>Get API key → Create API key</b> (gratis, sin tarjeta) y copiala.</li>
          <li>En <b>dash.cloudflare.com</b> (cuenta gratis): <b>Workers & Pages → Create → Worker</b>, ponele de nombre <i>stock-manager-ia</i> y tocá <b>Deploy</b>.</li>
          <li><b>Edit code</b>: borrá todo, pegá el archivo <i>worker.js</i> de Stock Manager y tocá <b>Deploy</b>.</li>
          <li><b>Settings → Variables and Secrets → Add</b>: tipo <b>Secret</b>, nombre <code>GEMINI_API_KEY</code>, valor la clave. Guardá.</li>
          <li>Copiá la dirección del worker (termina en <i>.workers.dev</i>), pegala arriba y tocá <b>Guardar</b>.</li>
        </ol>
        <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => void navigator.clipboard?.writeText('GEMINI_API_KEY').then(() => notify('Copiado: GEMINI_API_KEY'))}>
          <Copy size={15} aria-hidden /> Copiar el nombre del secreto
        </button>
      </section>
    </div>
  );
}

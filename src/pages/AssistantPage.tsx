import {
  ArrowUp, Camera, Check, CheckCircle2, ClipboardList, Copy, ImagePlus, Loader2, Mic, MicOff, RotateCcw, Sparkles, SquarePen, X, XCircle,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useCloud } from '../cloud/cloudService';
import { EmptyState } from '../components/ui';
import type { Permission } from '../models';
import type { AttachedImage, ChatMessage, ChatProposal } from '../services/assistant/engine';
import { compressImage } from '../services/imageService';
import { useAssistant, useAssistantAvailable } from '../store/assistant';
import { useFeedback } from '../store/feedback';
import { useSession } from '../store/session';

interface Suggestion { text: string; perms: Permission[]; photo?: boolean }

/** Ideas para empezar, según lo que cada perfil puede hacer. */
const SUGGESTIONS: Suggestion[] = [
  { text: '¿Qué tengo que reponer?', perms: ['stock.view'] },
  { text: 'Armame el pedido para mandarle a cada proveedor por WhatsApp', perms: ['stock.view'] },
  { text: '¿Cuánta harina se usó esta semana?', perms: ['movements.view'] },
  { text: '¿Qué aumentó en las últimas compras?', perms: ['invoices'] },
  { text: 'Anotá en el conteo: 12 cocas y 3 cajas de aceite', perms: ['count.do'] },
  { text: 'Llegó mercadería: te mando la foto del remito para cargarla', perms: ['stock.move'], photo: true },
  { text: 'Pasá a la app la receta de esta foto', perms: ['recipes', 'catalog.manage'], photo: true },
  { text: 'Anotá que salieron 40 medialunas', perms: ['production'] },
  { text: '¿Qué productos están en negativo?', perms: ['stock.view'] },
];

type SpeechRec = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const SpeechRecognition = (): (new () => SpeechRec) | undefined => {
  const w = globalThis as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/**
 * Asistente IA: cada persona escribe o dicta lo que necesita. Consulta datos reales de la app y,
 * si hay que cambiar algo, muestra exactamente qué va a hacer y espera la confirmación.
 */
export function AssistantPage() {
  const available = useAssistantAvailable();
  const cloud = useCloud();
  const { can, canAny, user } = useSession();
  const { engine, state } = useAssistant();
  const { notify, confirm } = useFeedback();
  const [text, setText] = useState('');
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [busyImg, setBusyImg] = useState(0);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const testing = !!(globalThis as { __smAssistantTransport?: unknown }).__smAssistantTransport;

  // Al llegar algo nuevo, se baja hasta el final de la página (el cuadro de escribir queda fijo
  // abajo: llevar sólo el último mensaje al borde lo dejaría tapado).
  const lastProposals = JSON.stringify(state.messages.at(-1)?.proposals?.map((p) => p.status) ?? []);
  useEffect(() => {
    if (!state.messages.length && !state.busy) return;
    const id = requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    return () => cancelAnimationFrame(id);
  }, [state.messages.length, state.busy, lastProposals]);
  useEffect(() => () => recRef.current?.stop(), []);

  if (!available) {
    return (
      <EmptyState icon={<Sparkles size={40} />} title="El asistente todavía no está activado"
        action={can('admin') ? <Link to="/configuracion/ia" className="btn btn-primary">Activar la IA</Link> : undefined}>
        {can('admin') ? 'Usa la misma conexión con Gemini que la lectura de facturas.' : 'Pedile a un administrador que active la IA en Configuración.'}
      </EmptyState>
    );
  }

  const offline = !testing && cloud.phase !== 'linked';
  const busy = state.busy || busyImg > 0;
  const canSend = !busy && !offline && (text.trim().length > 0 || images.length > 0);
  const suggestions = SUGGESTIONS.filter((x) => canAny(x.perms)).slice(0, 6);

  const send = async (value = text) => {
    if (!engine || busy || offline || (!value.trim() && !images.length)) return;
    recRef.current?.stop();
    const imgs = images;
    setText('');
    setImages([]);
    await engine.send(value, imgs);
    inputRef.current?.focus();
  };

  const addFiles = async (files: FileList | null) => {
    const list = [...(files ?? [])].slice(0, Math.max(0, 4 - images.length));
    if (!list.length) return;
    setBusyImg((b) => b + 1);
    try {
      for (const f of list) {
        try {
          const img = await compressImage(f);
          setImages((xs) => [...xs, { data: img.data, type: img.type, thumb: img.thumb }].slice(0, 4));
        } catch (e) {
          notify(e instanceof Error ? e.message : 'No se pudo leer la imagen.', { tone: 'error' });
        }
      }
    } finally {
      setBusyImg((b) => b - 1);
    }
  };

  const toggleMic = () => {
    if (listening) { recRef.current?.stop(); return; }
    const Rec = SpeechRecognition();
    if (!Rec) return;
    const rec = new Rec();
    rec.lang = 'es-AR';
    rec.interimResults = true;
    rec.continuous = true;
    const base = text.trim() ? `${text.trim()} ` : '';
    rec.onresult = (e) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      setText(base + said.trim());
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    rec.onerror = () => { setListening(false); recRef.current = null; notify('No pude escuchar. Revisá el permiso del micrófono.', { tone: 'error' }); };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const reset = async () => {
    if (state.messages.length && !(await confirm({ title: 'Nueva conversación', message: 'Se borra esta conversación de la pantalla (lo que ya se hizo en la app queda).', confirmLabel: 'Empezar de nuevo' }))) return;
    engine?.reset();
    setText('');
    setImages([]);
  };

  const pick = (s: Suggestion) => {
    if (s.photo) {
      setText(s.text);
      fileRef.current?.click();
      return;
    }
    void send(s.text);
  };

  const mic = !!SpeechRecognition();
  const empty = state.messages.length === 0;

  return (
    <div className="asst">
      <header className="asst-head">
        <div className="asst-title">
          <span className="asst-mark" aria-hidden><Sparkles size={20} /></span>
          <div>
            <h1>Asistente</h1>
            <p>Preguntá o pedí cosas de la app. Antes de cambiar algo te muestro qué voy a hacer.</p>
          </div>
        </div>
        {!empty && <button type="button" className="btn btn-sm" onClick={() => void reset()}><SquarePen size={16} aria-hidden /> Nueva conversación</button>}
      </header>

      {offline && <div className="alert" role="note"><span>El asistente necesita la nube: conectá este dispositivo en Cuenta y nube.</span></div>}

      <div className="asst-thread" role="log" aria-live="polite" aria-label="Conversación con el asistente">
        {empty && (
          <section className="asst-start">
            <p className="asst-hello">Hola{user ? `, ${user.name.split(' ')[0]}` : ''}. ¿En qué te ayudo?</p>
            {suggestions.length > 0 && (
              <ul className="asst-ideas" aria-label="Ideas para empezar">
                {suggestions.map((s) => (
                  <li key={s.text}>
                    <button type="button" className="asst-idea" disabled={offline} onClick={() => pick(s)}>
                      {s.photo ? <Camera size={16} aria-hidden /> : <ClipboardList size={16} aria-hidden />}
                      <span>{s.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="small muted">Responde con los datos reales de la app y sólo puede hacer lo que tu perfil tiene permitido. Usa Gemini (gratis, con un límite de consultas por día).</p>
          </section>
        )}

        {state.messages.map((m) => (
          <Message key={m.id} m={m} busy={state.busy}
            onConfirm={() => void engine?.confirm(m.id)} onCancel={() => engine?.cancel(m.id)} onRetry={() => void engine?.retry(m.id)} />
        ))}
        {state.busy && (
          <div className="asst-msg is-ai" role="status">
            <div className="asst-thinking"><Loader2 size={16} className="spin" aria-hidden /> Pensando…</div>
          </div>
        )}
      </div>

      <form className="asst-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {(images.length > 0 || busyImg > 0) && (
          <div className="asst-attach" aria-label="Fotos para enviar">
            {images.map((img, i) => (
              <figure key={i} className="asst-thumb">
                <img src={img.thumb} alt={`Foto ${i + 1}`} />
                <button type="button" className="asst-thumb-x" aria-label={`Quitar foto ${i + 1}`} onClick={() => setImages((xs) => xs.filter((_, k) => k !== i))}><X size={14} /></button>
              </figure>
            ))}
            {busyImg > 0 && <span className="asst-thumb processing" role="status"><Loader2 size={18} className="spin" aria-hidden /></span>}
          </div>
        )}
        <div className="asst-box">
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            placeholder={listening ? 'Te escucho…' : 'Escribí o dictá lo que necesitás'}
            aria-label="Mensaje para el asistente"
            disabled={offline}
          />
          <div className="asst-tools">
            <button type="button" className="asst-icon" onClick={() => camRef.current?.click()} disabled={offline || images.length >= 4} aria-label="Sacar foto" title="Sacar foto"><Camera size={20} /></button>
            <button type="button" className="asst-icon" onClick={() => fileRef.current?.click()} disabled={offline || images.length >= 4} aria-label="Adjuntar foto" title="Adjuntar foto"><ImagePlus size={20} /></button>
            {mic && (
              <button type="button" className={`asst-icon ${listening ? 'is-on' : ''}`} onClick={toggleMic} disabled={offline} aria-pressed={listening} aria-label={listening ? 'Dejar de dictar' : 'Dictar'} title={listening ? 'Dejar de dictar' : 'Dictar'}>
                {listening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
            )}
            <span className="grow" />
            <button type="submit" className="asst-send" disabled={!canSend} aria-label="Enviar"><ArrowUp size={20} /></button>
          </div>
        </div>
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden aria-label="Foto desde la cámara" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-label="Fotos desde la galería" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
      </form>
    </div>
  );
}

function Message({ m, busy, onConfirm, onCancel, onRetry }: { m: ChatMessage; busy: boolean; onConfirm: () => void; onCancel: () => void; onRetry: () => void }) {
  const { notify } = useFeedback();
  if (m.role === 'user') {
    return (
      <div className={`asst-msg is-user ${m.error ? 'is-failed' : ''}`}>
        {!!m.images?.length && <div className="asst-msg-imgs">{m.images.map((src, i) => <img key={i} src={src} alt={`Foto enviada ${i + 1}`} />)}</div>}
        {m.text && <div className="asst-bubble">{m.text}</div>}
        {m.retry && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={onRetry}><RotateCcw size={15} aria-hidden /> Reintentar</button>}
      </div>
    );
  }
  const pending = m.proposals?.some((p) => p.status === 'pending');
  return (
    <div className={`asst-msg is-ai ${m.error ? 'is-error' : ''}`}>
      {!!m.activity?.length && <div className="asst-activity">{m.activity.join(' · ')}</div>}
      {m.text && <div className="asst-text"><RichText text={m.text} /></div>}
      {!!m.proposals?.length && (
        <section className="asst-confirm" aria-label="Cambios para confirmar">
          {m.proposals.map((p, i) => <ProposalView key={i} p={p} />)}
          {pending && (
            <div className="row wrap asst-confirm-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}><Check size={17} aria-hidden /> Confirmar</button>
              <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancelar</button>
            </div>
          )}
        </section>
      )}
      {!!m.links?.length && (
        <div className="row wrap">
          {m.links.map((l) => <Link key={l.to} to={l.to} className="btn btn-sm">Abrir {l.label}</Link>)}
        </div>
      )}
      {m.text && !m.error && !m.proposals?.length && m.text.length > 120 && (
        <button type="button" className="asst-copy" onClick={() => void navigator.clipboard?.writeText(plain(m.text)).then(() => notify('Copiado'))}>
          <Copy size={14} aria-hidden /> Copiar
        </button>
      )}
    </div>
  );
}

const STATUS: Record<ChatProposal['status'], { label: string; icon?: ReactNode }> = {
  pending: { label: 'Para confirmar' },
  running: { label: 'Aplicando…', icon: <Loader2 size={15} className="spin" aria-hidden /> },
  done: { label: 'Hecho', icon: <CheckCircle2 size={15} aria-hidden /> },
  cancelled: { label: 'Cancelado', icon: <XCircle size={15} aria-hidden /> },
  error: { label: 'No se pudo', icon: <XCircle size={15} aria-hidden /> },
};

function ProposalView({ p }: { p: ChatProposal }) {
  const st = STATUS[p.status];
  return (
    <div className={`asst-prop is-${p.status}`}>
      <div className="asst-prop-head">
        <strong>{p.title}</strong>
        <span className="asst-prop-status">{st.icon}{st.label}</span>
      </div>
      <ul className="asst-prop-lines">{p.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {p.notes.length > 0 && <ul className="asst-prop-notes">{p.notes.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {p.result && p.status !== 'pending' && <p className="asst-prop-result">{p.result}</p>}
    </div>
  );
}

/** Texto con listas ("- ") y **negritas**, sin HTML (lo que escribe la IA nunca se inyecta como código). */
function RichText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  let cur: { list: boolean; lines: string[] } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd().replace(/^#+\s+(.*)$/, '**$1**');
    if (!line.trim()) { cur = null; continue; }
    const m = /^\s*(?:[-*•]|\d+[.)])\s+/.exec(line);
    const list = !!m;
    if (!cur || cur.list !== list) { cur = { list, lines: [] }; blocks.push(cur); }
    cur.lines.push(m ? line.slice(m[0].length) : line);
  }
  return (
    <>
      {blocks.map((b, i) => (b.list
        ? <ul key={i}>{b.lines.map((l, k) => <li key={k}><Inline text={l} /></li>)}</ul>
        : <p key={i}>{b.lines.map((l, k) => <Fragment key={k}>{k > 0 && <br />}<Inline text={l} /></Fragment>)}</p>))}
    </>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>))}</>;
}

const plain = (t: string) => t.replace(/\*\*([^*]+)\*\*/g, '$1');

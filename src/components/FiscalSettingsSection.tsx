import { AlertTriangle, CheckCircle2, KeyRound, PlugZap, Receipt, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/cloudService';
import type { FiscalSettings, IvaRate } from '../models';
import { DEFAULT_FISCAL, EMISOR_COND_LABEL, IVA_RATES, fiscalMissing, fiscalOf, fmtCuit, serviceStatus, validCuit } from '../services/fiscalService';
import { updateSettings } from '../services/settingsService';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Field, Input, NumberInput, PageHeader, Segmented, Select } from './ui';

interface CertState { cert: boolean; cn?: string; cuit?: string; vence?: string; key?: boolean; error?: string }
interface Status {
  cuit?: string; kv?: boolean; prodEnabled?: boolean;
  homologacion?: CertState; produccion?: CertState;
  servidores?: { app?: string; db?: string; auth?: string }; autenticacion?: string;
  puntosDeVenta?: { nro: number; tipo?: string; bloqueado?: boolean; baja?: string }[]; ultimoFB?: number;
}

const daysTo = (iso?: string) => (iso ? Math.floor((Date.parse(iso) - Date.now()) / 86_400_000) : NaN);

/**
 * Configuración → Configuración fiscal (ARCA). Acá van los datos del emisor y del punto de venta.
 * El certificado digital y la clave privada NO se cargan acá: se guardan como secretos en el
 * servicio de ARCA (Cloudflare). La clave fiscal de ARCA no se pide ni se guarda nunca.
 */
export function FiscalSettingsSection() {
  const settings = useSettings();
  const cloud = useCloud();
  const { run, notify, confirm } = useFeedback();
  const [f, setF] = useState<FiscalSettings>(fiscalOf(settings));
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  useEffect(() => setF(fiscalOf(settings)), [settings]);

  const set = <K extends keyof FiscalSettings>(k: K, v: FiscalSettings[K]) => setF((p) => ({ ...p, [k]: v }));
  const missing = fiscalMissing(f);
  const dirty = JSON.stringify(f) !== JSON.stringify(fiscalOf(settings));

  const save = async () => {
    const clean: FiscalSettings = { ...DEFAULT_FISCAL, ...f, cuit: f.cuit.replace(/\D/g, ''), serviceUrl: f.serviceUrl.trim().replace(/\/+$/, ''), razonSocial: f.razonSocial.trim(), domicilio: f.domicilio.trim() };
    if (clean.enabled && missing.length) return notify(`Para activar la facturación falta: ${missing.join(', ')}.`, { tone: 'error' });
    const prev = fiscalOf(settings);
    if (clean.ambiente === 'produccion' && prev.ambiente !== 'produccion') {
      const ok = await confirm({ title: '¿Pasar a producción?', message: 'Desde ahora cada factura que se emita es REAL ante ARCA. Hacelo sólo después de probar en homologación y con el certificado de producción cargado en Cloudflare.', confirmLabel: 'Pasar a producción', danger: true });
      if (!ok) return;
    }
    await run(() => updateSettings({ fiscal: clean }), 'Configuración fiscal guardada');
  };

  const test = async () => {
    setTesting(true);
    setError('');
    try {
      setStatus((await serviceStatus(true)) as Status);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
      try { setStatus((await serviceStatus(false)) as Status); } catch { /* sin servicio */ }
    } finally {
      setTesting(false);
    }
  };

  const cert = status?.[f.ambiente];
  const certCuitOk = cert?.cuit && cert.cuit === f.cuit.replace(/\D/g, '');
  const pv = status?.puntosDeVenta?.find((p) => p.nro === f.ptoVta);
  const vence = daysTo(cert?.vence);

  return (
    <div className="stack">
      <PageHeader title="Configuración fiscal" subtitle="Factura electrónica de ARCA desde el Salón: datos del emisor, punto de venta y conexión." />

      {f.ambiente === 'produccion' && f.enabled
        ? <div className="alert alert-danger" role="note"><AlertTriangle size={18} aria-hidden /><span><b>Producción:</b> las facturas que se emiten son reales ante ARCA.</span></div>
        : <div className="alert alert-info" role="note"><ShieldCheck size={18} aria-hidden /><span><b>Homologación:</b> ambiente de prueba de ARCA. Los comprobantes no tienen validez fiscal.</span></div>}
      {cloud.phase !== 'linked' && <div className="alert"><span>Este dispositivo no está conectado a la nube: hace falta para facturar (Cuenta y nube).</span></div>}

      <section className="card card-pad stack">
        <h2 className="row"><Receipt size={18} aria-hidden /> Facturación</h2>
        <label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Facturar desde Stock Manager al cobrar las mesas</label>
        <p className="small muted" style={{ margin: 0 }}>Con esto activado, al cobrar un pedido se emite la factura electrónica de ARCA acá mismo. Apagado, se registra el cobro sin factura.</p>
        <Segmented<FiscalSettings['ambiente']> label="Ambiente" value={f.ambiente} onChange={(v) => set('ambiente', v)}
          options={[{ value: 'homologacion', label: 'Homologación (pruebas)' }, { value: 'produccion', label: 'Producción (facturas reales)' }]} />
        {cloud.workspace?.id && (
          <p className="small" style={{ margin: 0 }}>
            Id de este espacio de trabajo (va en el secreto <b>ARCA_WORKSPACE</b> de Cloudflare): <code className="fiscal-code">{cloud.workspace.id}</code>{' '}
            <button type="button" className="link-btn" onClick={() => void navigator.clipboard?.writeText(cloud.workspace!.id).then(() => notify('Id copiado'))}>Copiar</button>
          </p>
        )}
        <Field label="Dirección del servicio de ARCA" hint="la del Worker de Cloudflare, termina en .workers.dev">
          <Input value={f.serviceUrl} onChange={(e) => set('serviceUrl', e.target.value)} placeholder="https://stock-manager-arca.tu-usuario.workers.dev" inputMode="url" autoComplete="off" spellCheck={false} />
        </Field>
      </section>

      <section className="card card-pad stack">
        <h2>Emisor</h2>
        <div className="form-grid cols-2">
          <Field label="CUIT"><Input value={f.cuit} onChange={(e) => set('cuit', e.target.value)} inputMode="numeric" placeholder="30-12345678-9" /></Field>
          <Field label="Condición frente al IVA">
            <Select value={f.condicionIva} onChange={(e) => set('condicionIva', e.target.value as FiscalSettings['condicionIva'])}>
              {(Object.keys(EMISOR_COND_LABEL) as FiscalSettings['condicionIva'][]).map((k) => <option key={k} value={k}>{EMISOR_COND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Razón social"><Input value={f.razonSocial} onChange={(e) => set('razonSocial', e.target.value)} /></Field>
          <Field label="Nombre de fantasía (opcional)"><Input value={f.nombreFantasia ?? ''} onChange={(e) => set('nombreFantasia', e.target.value)} /></Field>
          <Field label="Domicilio fiscal"><Input value={f.domicilio} onChange={(e) => set('domicilio', e.target.value)} /></Field>
          <Field label="Ingresos Brutos (opcional)"><Input value={f.iibb ?? ''} onChange={(e) => set('iibb', e.target.value)} /></Field>
          <Field label="Inicio de actividades (opcional)"><Input type="date" value={f.inicioActividades ?? ''} onChange={(e) => set('inicioActividades', e.target.value)} /></Field>
        </div>
        {f.cuit && !validCuit(f.cuit) && <p className="small" role="alert" style={{ color: 'var(--crit)', margin: 0 }}>El CUIT no es válido (revisá el último número).</p>}
      </section>

      <section className="card card-pad stack">
        <h2>Punto de venta y comprobantes</h2>
        <div className="form-grid cols-2">
          <Field label="Punto de venta" hint="uno nuevo de tipo “Web Services”, sólo para Stock Manager"><NumberInput value={f.ptoVta || undefined} onChange={(v) => set('ptoVta', Math.trunc(v ?? 0))} min={1} /></Field>
          <Field label="Concepto">
            <Select value={f.concepto} onChange={(e) => set('concepto', Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>Productos</option><option value={2}>Servicios</option><option value={3}>Productos y servicios</option>
            </Select>
          </Field>
          <Field label="IVA de la carta (por defecto)" hint="los precios de la carta incluyen IVA">
            <Select value={f.ivaDefault} onChange={(e) => set('ivaDefault', Number(e.target.value) as IvaRate)}>
              {IVA_RATES.map((r) => <option key={r} value={r}>{String(r).replace('.', ',')}%</option>)}
            </Select>
          </Field>
          {f.condicionIva === 'RI' && (
            <Field label="Facturas a inscriptos" hint="ARCA te indica si te corresponde la M">
              <Select value={f.letraA} onChange={(e) => set('letraA', e.target.value as 'A' | 'M')}><option value="A">Factura A</option><option value="M">Factura M</option></Select>
            </Field>
          )}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {f.condicionIva === 'RI' ? 'Se emite Factura A (o M) a Responsables Inscriptos y Monotributistas, y Factura B a consumidores finales, exentos y no alcanzados. Se elige sola según el cliente.' : 'Como monotributista o exento, siempre se emite Factura C.'}
        </p>
        <Field label="Pie del ticket (opcional)"><Input value={f.pie ?? ''} onChange={(e) => set('pie', e.target.value)} placeholder="¡Gracias por venir!" /></Field>
      </section>

      <div className="row wrap">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!dirty}>Guardar</button>
        <button type="button" className="btn" onClick={() => void test()} disabled={testing || !f.serviceUrl || dirty || cloud.phase !== 'linked'}><PlugZap size={18} aria-hidden /> {testing ? 'Probando…' : 'Probar conexión con ARCA'}</button>
        {dirty && <span className="small muted">Guardá antes de probar.</span>}
      </div>

      {(status || error) && (
        <section className="card card-pad stack" aria-label="Estado de la conexión">
          <h2 className="row"><KeyRound size={18} aria-hidden /> Estado del servicio ({f.ambiente === 'produccion' ? 'producción' : 'homologación'})</h2>
          {error && <Check ok={false}>{error}</Check>}
          {status && <>
            <Check ok={!!cert?.cert && !cert.error && !!cert.key}>{cert?.cert ? (cert.error ?? (cert.key ? `Certificado cargado (${cert.cn ?? 'sin nombre'})` : 'Falta la clave privada en Cloudflare')) : 'Falta cargar el certificado en Cloudflare'}</Check>
            {cert?.cuit && <Check ok={!!certCuitOk}>{certCuitOk ? `El certificado es del CUIT ${fmtCuit(cert.cuit)}` : `El certificado es del CUIT ${fmtCuit(cert.cuit)}, distinto del configurado`}</Check>}
            {status.cuit && <Check ok={status.cuit === f.cuit.replace(/\D/g, '')}>{status.cuit === f.cuit.replace(/\D/g, '') ? 'El CUIT del servicio coincide' : `El servicio tiene el CUIT ${fmtCuit(status.cuit)} (ARCA_CUIT), distinto del configurado`}</Check>}
            {cert?.vence && <Check ok={vence > 30}>{vence > 0 ? `El certificado vence el ${new Date(cert.vence).toLocaleDateString('es-AR')} (en ${vence} días)${vence <= 30 ? ': renovalo' : ''}` : 'El certificado está vencido'}</Check>}
            <Check ok={!!status.kv}>{status.kv ? 'Token guardado en Cloudflare KV' : 'Falta el KV ARCA_TA en Cloudflare (recomendado: sin él puede trabarse la autenticación)'}</Check>
            {f.ambiente === 'produccion' && <Check ok={!!status.prodEnabled}>{status.prodEnabled ? 'Producción habilitada en el servicio' : 'Producción no habilitada en el servicio (ARCA_PROD_ENABLED)'}</Check>}
            {status.servidores && <Check ok={status.servidores.app === 'OK' && status.servidores.db === 'OK' && status.servidores.auth === 'OK'}>Servidores de ARCA: aplicación {status.servidores.app}, base {status.servidores.db}, autenticación {status.servidores.auth}</Check>}
            {status.autenticacion && <Check ok>Autenticación con ARCA (WSAA) correcta</Check>}
            {status.puntosDeVenta && (
              <Check ok={(!!pv && !pv.bloqueado && !pv.baja) || (!pv && f.ambiente === 'homologacion')}>
                {pv ? `Punto de venta ${f.ptoVta} habilitado (${pv.tipo ?? 'web service'})${pv.bloqueado ? ' pero BLOQUEADO' : ''}${pv.baja ? ' pero dado de BAJA' : ''}` : f.ambiente === 'homologacion' ? `En homologación ARCA no lista puntos de venta: se puede probar con el ${f.ptoVta}` : `El punto de venta ${f.ptoVta} no aparece en ARCA como Web Services`}
              </Check>
            )}
            {status.ultimoFB !== undefined && <p className="small muted" style={{ margin: 0 }}>Última Factura B autorizada en el punto {f.ptoVta}: {status.ultimoFB}</p>}
          </>}
        </section>
      )}

      <section className="card card-pad stack">
        <h2 className="row"><ShieldCheck size={18} aria-hidden /> Certificado y seguridad</h2>
        <p className="small muted" style={{ margin: 0 }}>
          El certificado digital y la clave privada <b>no se cargan acá</b>: se guardan como secretos en el servicio de ARCA (Cloudflare) y nunca llegan a la app ni a los celulares. La <b>clave fiscal</b> de ARCA no se pide ni se guarda nunca. Sólo pueden facturar el dueño, los administradores y los usuarios con el permiso “Cobrar y facturar”.
        </p>
      </section>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className="row fiscal-check" style={{ margin: 0, alignItems: 'flex-start' }}>
      {ok ? <CheckCircle2 size={18} aria-hidden style={{ color: 'var(--ok)', flex: 'none' }} /> : <XCircle size={18} aria-hidden style={{ color: 'var(--crit)', flex: 'none' }} />}
      <span>{children}</span>
    </p>
  );
}

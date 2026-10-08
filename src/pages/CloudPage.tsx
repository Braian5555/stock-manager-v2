import { Cloud, CloudOff, LogOut, Mail, MailCheck, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  ROLE_LABEL, cancelInvite, createWorkspace, deleteWorkspace, inviteEmail, openWorkspace, recheckVerification, refreshLists, removeMember, resendVerification,
  setMemberRole, signIn, signOutCloud, unlinkDevice, useCloud,
} from '../cloud/cloudService';
import { PasswordLogin } from '../components/auth/PasswordLogin';
import type { Workspace } from '../cloud/types';
import { menuLabel } from '../services/settingsService';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Badge, Field, Input, PageHeader, Select } from '../components/ui';
import { fmtDateTime } from '../utils/format';
import { SyncBadge } from '../components/SyncBadge';

const GUIDE_URL = 'https://github.com/Braian5555/stock-manager-v2/blob/main/docs/firebase.md';

export function CloudPage() {
  const settings = useSettings();
  const cloud = useCloud();
  const { run, confirm, notify } = useFeedback();
  const [wsName, setWsName] = useState(settings.businessName);
  const [email, setEmail] = useState('');
  // Al abrir la página se actualiza la lista de espacios (por si se crearon o borraron en otro dispositivo).
  useEffect(() => {
    void refreshLists();
  }, []);

  const open = async (ws: Workspace, invited: boolean) => {
    const ok = await confirm({
      title: invited ? `Unirme a "${ws.name}"` : `Usar "${ws.name}" en este dispositivo`,
      message: (
        <>
          <p>Los datos de este dispositivo se van a <b>reemplazar</b> por los del espacio "{ws.name}".</p>
          <p className="small muted">Si cargaste datos acá que no están en la nube, exportá un backup antes (Exportar y backup). Igual se guarda una copia interna por seguridad.</p>
        </>
      ),
      confirmLabel: invited ? 'Unirme' : 'Usar este espacio',
    });
    if (ok) await run(() => openWorkspace(ws), invited ? 'Te uniste al espacio. Sincronizando…' : 'Sincronizando…');
  };

  const remove = async (ws: Workspace) => {
    const ok = await confirm({
      title: `Borrar el espacio "${ws.name}"`,
      message: (
        <>
          <p>Se borran de la nube <b>todos los datos</b> de este espacio (productos, movimientos, pedidos, facturas, usuarios…). No se puede deshacer.</p>
          <p className="small muted">Creado el {fmtDateTime(ws.createdAt)} · {ws.memberUids.length} {ws.memberUids.length === 1 ? 'miembro' : 'miembros'}. Los dispositivos que lo usaban se quedan con su copia local.</p>
        </>
      ),
      danger: true,
      confirmLabel: 'Borrar espacio',
    });
    if (ok) await run(() => deleteWorkspace(ws), 'Espacio borrado');
  };

  const create = async () => {
    const ok = await confirm({
      title: 'Crear espacio en la nube',
      message: <p>Se crea el espacio "<b>{wsName || 'Mi negocio'}</b>" y se suben todos los datos de este dispositivo. Después podés invitar a otras personas por email.</p>,
      confirmLabel: 'Crear y subir datos',
    });
    if (ok) await run(() => createWorkspace(wsName), 'Espacio creado. Tus datos se están subiendo.');
  };

  return (
    <>
      <PageHeader title={menuLabel(settings, 'cloud')} subtitle="Iniciá sesión para guardar tus datos en la nube y usarlos en todos tus dispositivos." />
      {cloud.provider === 'fake' && <div className="alert alert-demo" style={{ marginBottom: 12 }}>Nube de prueba (en memoria): sólo para pruebas automáticas.</div>}
      {cloud.error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{cloud.error}</div>}

      {cloud.phase === 'loading' && <SlowLoading />}

      {cloud.phase === 'unconfigured' && (
        <section className="card card-pad stack">
          <h2 className="row"><CloudOff size={20} aria-hidden /> La nube todavía no está configurada</h2>
          <p className="muted">La app funciona completa en este dispositivo. Para sincronizar con Google hay que crear un proyecto gratuito de Firebase y cargar su configuración en el archivo <code>public/firebase-config.json</code> del repositorio.</p>
          <a className="btn" href={GUIDE_URL} target="_blank" rel="noopener noreferrer">Ver la guía paso a paso</a>
        </section>
      )}

      {cloud.phase === 'signed_out' && (
        <section className="card card-pad stack">
          <h2 className="row"><Cloud size={20} aria-hidden /> Guardar en la nube</h2>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Tus datos quedan guardados en la nube y en este dispositivo.</li>
            <li>Lo que cargás en el celular aparece en la computadora (y al revés).</li>
            <li>Podés invitar a empleados por email. Sin Internet seguís trabajando y se sincroniza al volver.</li>
          </ul>
          <PasswordLogin />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(signIn)}>Entrar con una cuenta de Google</button>
        </section>
      )}

      {cloud.user && (cloud.phase === 'no_workspace' || cloud.phase === 'linked') && (
        <section className="card card-pad row wrap between" style={{ marginBottom: 16 }}>
          <div className="row">
            {cloud.user.photoURL ? <img src={cloud.user.photoURL} alt="" width={36} height={36} style={{ borderRadius: '50%' }} referrerPolicy="no-referrer" /> : <span className="stat-icon" aria-hidden><Users size={18} /></span>}
            <div>
              <div className="list-title">{cloud.user.name ?? cloud.user.email}</div>
              <div className="list-sub">{cloud.user.email}</div>
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => run(signOutCloud, 'Sesión cerrada. Los datos siguen en este dispositivo.')}><LogOut size={16} aria-hidden /> Cerrar sesión</button>
        </section>
      )}

      {cloud.phase === 'no_workspace' && cloud.user?.emailVerified === false && (
        <section className="card card-pad stack" style={{ marginBottom: 16 }}>
          <h2 className="row"><MailCheck size={18} aria-hidden /> Verificá tu email</h2>
          <p className="small muted">Te enviamos un email a <b>{cloud.user.email}</b>. Tocá el link que trae (revisá también spam) y después el botón de abajo. Hace falta para unirte a un espacio al que te invitaron.</p>
          <div className="row wrap">
            <button type="button" className="btn btn-primary" onClick={() => run(recheckVerification)}>Ya verifiqué mi email</button>
            <button type="button" className="btn btn-ghost" onClick={() => run(resendVerification, 'Email reenviado')}>Reenviar email</button>
          </div>
        </section>
      )}

      {cloud.phase === 'no_workspace' && (
        <div className="stack">
          {cloud.invites.length > 0 && (
            <section className="card card-pad stack">
              <h2 className="row"><Mail size={18} aria-hidden /> Invitaciones</h2>
              {cloud.invites.map((ws) => (
                <div key={ws.id} className="row between wrap">
                  <span><b>{ws.name}</b> <span className="muted small">· te invitó {ws.memberInfo[ws.ownerUid]?.email ?? 'el dueño'}</span></span>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => open(ws, true)}>Unirme</button>
                </div>
              ))}
            </section>
          )}
          {cloud.myWorkspaces.length > 0 && (
            <section className="card card-pad stack">
              <h2>Tus espacios</h2>
              {cloud.myWorkspaces.map((ws) => (
                <div key={ws.id} className="row between wrap">
                  <span><b>{ws.name}</b> <span className="muted small">· {ws.memberUids.length} {ws.memberUids.length === 1 ? 'miembro' : 'miembros'} · creado {fmtDateTime(ws.createdAt)}</span></span>
                  <span className="row">
                    <button type="button" className="btn btn-sm" onClick={() => open(ws, false)}>Usar en este dispositivo</button>
                    {ws.ownerUid === cloud.user?.uid && (
                      <button type="button" className="btn btn-sm btn-ghost icon-btn btn-danger" aria-label={`Borrar el espacio ${ws.name}`} onClick={() => remove(ws)}><Trash2 size={16} /></button>
                    )}
                  </span>
                </div>
              ))}
            </section>
          )}
          <section className="card card-pad stack">
            <h2>Crear un espacio nuevo</h2>
            <p className="small muted">Usá esta opción en el dispositivo que tiene tus datos actuales. En los demás dispositivos, iniciá sesión y elegí “Usar en este dispositivo”.</p>
            <Field label="Nombre del espacio"><Input value={wsName} onChange={(e) => setWsName(e.target.value)} maxLength={60} /></Field>
            <div className="row wrap">
              <button type="button" className="btn btn-primary" onClick={create}>Crear y subir mis datos</button>
              <button type="button" className="btn btn-ghost" onClick={() => run(refreshLists)}><RefreshCw size={16} aria-hidden /> Actualizar</button>
            </div>
          </section>
        </div>
      )}

      {cloud.phase === 'linked' && (
        <div className="stack">
          <section className="card card-pad stack">
            <div className="row between wrap">
              <h2 className="row"><Cloud size={20} aria-hidden /> {cloud.workspace?.name ?? 'Espacio'}</h2>
              <SyncBadge />
            </div>
            <dl className="kv">
              <dt>Última sincronización</dt><dd>{fmtDateTime(cloud.status.lastSyncAt)}</dd>
              <dt>Cambios por enviar</dt><dd>{cloud.status.pending}</dd>
              {cloud.workspace && <><dt>Espacio creado</dt><dd>{fmtDateTime(cloud.workspace.createdAt)}</dd></>}
              {cloud.user && cloud.workspace && <><dt>Tu rol</dt><dd>{ROLE_LABEL[cloud.workspace.roles[cloud.user.uid] ?? 'member']}</dd></>}
            </dl>
            {cloud.status.error && <p className="small" style={{ color: 'var(--out)' }}>{cloud.status.error}</p>}
            <p className="small muted">Sin Internet podés seguir trabajando: los cambios se guardan en el dispositivo y se envían solos al volver la conexión.</p>
            <div>
              <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await confirm({ title: 'Desvincular este dispositivo', message: 'Este dispositivo deja de sincronizar. No se borra nada, ni acá ni en la nube.', confirmLabel: 'Desvincular' })) && run(unlinkDevice, 'Dispositivo desvinculado')}>
                Desvincular este dispositivo
              </button>
            </div>
          </section>

          {cloud.myWorkspaces.some((w) => w.id !== cloud.workspace?.id) && (
            <section className="card card-pad stack" aria-labelledby="otros-espacios">
              <h2 id="otros-espacios">Otros espacios tuyos</h2>
              <p className="small muted">No los usa este dispositivo. Si son de prueba, podés borrarlos.</p>
              {cloud.myWorkspaces.filter((w) => w.id !== cloud.workspace?.id).map((ws) => (
                <div key={ws.id} className="row between wrap">
                  <span><b>{ws.name}</b> <span className="muted small">· creado {fmtDateTime(ws.createdAt)}</span></span>
                  {ws.ownerUid === cloud.user?.uid && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(ws)}><Trash2 size={16} aria-hidden /> Borrar</button>
                  )}
                </div>
              ))}
            </section>
          )}

          {cloud.workspace && cloud.user && <Members ws={cloud.workspace} me={cloud.user.uid} email={email} setEmail={setEmail} onInvite={async () => {
            const ok = await run(() => inviteEmail(email).then(() => true));
            if (ok) {
              notify(`Invitación creada para ${email}. Tiene que entrar a la app y crear su cuenta con ese mismo email.`);
              setEmail('');
            }
          }} />}

          <section className="card card-pad stack">
            <h2 className="row"><ShieldCheck size={18} aria-hidden /> Privacidad</h2>
            <p className="small muted">Los datos se guardan en tu proyecto de Firebase (Google Cloud). Sólo las cuentas que son miembros del espacio pueden leerlos o modificarlos. Las contraseñas las guarda Firebase Authentication: la app no las almacena.</p>
          </section>
        </div>
      )}
    </>
  );
}

function Members({ ws, me, email, setEmail, onInvite }: { ws: Workspace; me: string; email: string; setEmail: (v: string) => void; onInvite: () => void }) {
  const { run, confirm } = useFeedback();
  const manage = ['owner', 'admin'].includes(ws.roles[me] ?? '');
  return (
    <section className="card card-pad stack" aria-labelledby="miembros">
      <h2 id="miembros" className="row"><Users size={18} aria-hidden /> Miembros</h2>
      <div className="list">
        {ws.memberUids.map((uid) => {
          const info = ws.memberInfo[uid];
          const role = ws.roles[uid] ?? 'member';
          return (
            <div key={uid} className="list-item" style={{ padding: '10px 0' }}>
              <div className="grow">
                <div className="list-title truncate">{info?.name ?? info?.email ?? uid} {uid === me && <Badge>Vos</Badge>}</div>
                <div className="list-sub truncate">{info?.email}</div>
              </div>
              {manage && role !== 'owner' && uid !== me ? (
                <>
                  <Select aria-label={`Rol de ${info?.email}`} value={role} onChange={(e) => run(() => setMemberRole(uid, e.target.value as 'admin' | 'member'))} style={{ width: 160 }}>
                    <option value="member">Miembro</option>
                    <option value="admin">Administrador</option>
                  </Select>
                  <button type="button" className="btn btn-sm btn-ghost icon-btn btn-danger" aria-label={`Quitar a ${info?.email}`} onClick={async () => (await confirm({ title: 'Quitar miembro', message: `${info?.email} dejará de tener acceso a los datos.`, danger: true, confirmLabel: 'Quitar' })) && run(() => removeMember(uid), 'Miembro quitado')}>
                    <Trash2 size={16} />
                  </button>
                </>
              ) : (
                <Badge tone={role === 'owner' ? 'primary' : ''}>{ROLE_LABEL[role]}</Badge>
              )}
            </div>
          );
        })}
      </div>
      {ws.inviteEmails.length > 0 && (
        <div className="stack-sm">
          <span className="small muted">Invitaciones pendientes</span>
          {ws.inviteEmails.map((e) => (
            <div key={e} className="row between">
              <span className="small">{e}</span>
              {manage && <button type="button" className="btn btn-sm btn-ghost" onClick={() => run(() => cancelInvite(e))}>Cancelar</button>}
            </div>
          ))}
        </div>
      )}
      {manage && (
        <form className="row wrap" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); onInvite(); }}>
          <Field label="Invitar por email" className="grow">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="empleado@gmail.com" />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={!email.trim()}><UserPlus size={18} aria-hidden /> Invitar</button>
        </form>
      )}
    </section>
  );
}

/** Si la conexión con Google tarda demasiado, se ofrece recargar en vez de dejar "Cargando…" para siempre. */
function SlowLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, []);
  if (!slow) return <p className="muted">Cargando…</p>;
  return (
    <div className="card card-pad stack" role="status">
      <p>La conexión con Google está tardando más de lo normal.</p>
      <p className="small muted">Revisá la conexión a Internet. Si la app está instalada y acabás de actualizarla, cerrala del todo y volvé a abrirla.</p>
      <div><button type="button" className="btn" onClick={() => location.reload()}>Reintentar</button></div>
    </div>
  );
}

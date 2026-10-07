import { KeyRound, Pencil, Plus, Trash2, UserCog } from 'lucide-react';
import { useState } from 'react';
import { PERMISSIONS, type AppUser, type Permission, type UserRole } from '../models';
import { PERMISSION_LABEL, PIN_RE, ROLE_LABEL, ROLE_PERMISSIONS, deleteUser, saveUser, type UserDraft } from '../services/userService';
import { updateSettings } from '../services/settingsService';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { useFeedback } from '../store/feedback';
import { Modal } from '../components/ui/Modal';
import { Badge, Field, Input, PageHeader, Select } from '../components/ui';
import { UserAvatar } from '../components/auth/UserAvatar';

const ROLE_HELP: Record<UserRole, string> = {
  admin: 'Todo, incluidos usuarios, configuración, nube e integraciones.',
  manager: 'Todo el trabajo diario (stock, conteos, pedidos, productos, exportar). Sin administración.',
  staff: 'Ver stock, hacer conteos y recibir pedidos.',
  custom: 'Elegí permiso por permiso.',
};

export function UsersPage() {
  const { users, user: me } = useSession();
  const settings = useSettings();
  const { run, confirm, notify } = useFeedback();
  const [editing, setEditing] = useState<(UserDraft & { pin2?: string }) | null>(null);
  const [isNew, setIsNew] = useState(false);
  const sorted = [...users].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es'));

  const openNew = () => {
    setIsNew(true);
    setEditing({ name: '', role: 'staff', permissions: ROLE_PERMISSIONS.staff, active: true, pin: '', pin2: '' });
  };
  const openEdit = (u: AppUser) => {
    setIsNew(false);
    setEditing({ id: u.id, name: u.name, role: u.role, permissions: u.permissions, active: u.active });
  };

  const save = async () => {
    if (!editing) return;
    const { pin2, ...d } = editing;
    if (isNew || d.pin) {
      if (!d.pin || !PIN_RE.test(d.pin)) return notify('El PIN debe tener entre 4 y 6 números.', { tone: 'error' });
      if (d.pin !== pin2) return notify('Los PIN no coinciden.', { tone: 'error' });
    } else delete d.pin;
    const ok = await run(() => saveUser(d), isNew ? 'Usuario creado' : 'Cambios guardados');
    if (ok) setEditing(null);
  };

  const remove = async (u: AppUser) => {
    if (u.id === me?.id) return notify('No podés eliminar tu propio usuario mientras lo usás.', { tone: 'error' });
    const ok = await confirm({ title: 'Eliminar usuario', message: <p>¿Eliminar a <b>{u.name}</b>? El historial de lo que hizo se conserva. Si sólo querés impedirle el acceso, podés desactivarlo.</p>, danger: true, confirmLabel: 'Eliminar' });
    if (ok) await run(() => deleteUser(u.id), 'Usuario eliminado');
  };

  const setPerm = (p: Permission, on: boolean) =>
    setEditing((e) => (e ? { ...e, role: 'custom', permissions: on ? [...e.permissions, p] : e.permissions.filter((x) => x !== p) } : e));

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Cada persona entra con su nombre y su PIN. Lo que haga queda registrado a su nombre."
        actions={<button type="button" className="btn btn-primary" onClick={openNew}><Plus size={18} aria-hidden /> Nuevo usuario</button>}
      />
      <div className="card list">
        {sorted.map((u) => (
          <div key={u.id} className="list-item" style={{ opacity: u.active ? 1 : 0.6 }}>
            <UserAvatar user={u} />
            <div className="grow">
              <div className="list-title truncate">{u.name} {u.id === me?.id && <Badge>Vos</Badge>} {!u.active && <Badge>Desactivado</Badge>}</div>
              <div className="list-sub">{ROLE_LABEL[u.role]} · {u.permissions.length} permisos</div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Editar ${u.name}`} onClick={() => openEdit(u)}><Pencil size={16} /></button>
            <button type="button" className="btn btn-sm btn-ghost icon-btn btn-danger" aria-label={`Eliminar ${u.name}`} onClick={() => remove(u)}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>

      <section className="card card-pad stack" style={{ marginTop: 16 }} aria-labelledby="bloqueo">
        <h2 id="bloqueo" className="row"><KeyRound size={18} aria-hidden /> Bloqueo automático</h2>
        <Field label="Pedir el PIN otra vez después de">
          <Select value={String(settings.autoLockMinutes)} onChange={(e) => run(() => updateSettings({ autoLockMinutes: Number(e.target.value) }))} style={{ maxWidth: 260 }}>
            <option value="5">5 minutos sin uso</option>
            <option value="15">15 minutos sin uso</option>
            <option value="30">30 minutos sin uso</option>
            <option value="60">1 hora sin uso</option>
            <option value="0">Nunca (sólo con “Bloquear”)</option>
          </Select>
        </Field>
        <p className="small muted">En un celular o tablet compartido conviene un tiempo corto. Después de 5 PIN incorrectos seguidos, la app espera antes de permitir otro intento.</p>
      </section>

      <Modal open={!!editing} wide title={isNew ? 'Nuevo usuario' : `Editar ${editing?.name ?? ''}`} onClose={() => setEditing(null)}
        footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" form="user-form" className="btn btn-primary">Guardar</button></>}>
        {editing && (
          <form id="user-form" className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="form-grid cols-2">
              <Field label="Nombre"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={40} data-autofocus /></Field>
              <Field label="Rol">
                <Select value={editing.role} onChange={(e) => { const role = e.target.value as UserRole; setEditing({ ...editing, role, permissions: role === 'custom' ? editing.permissions : ROLE_PERMISSIONS[role] }); }}>
                  {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </Select>
              </Field>
              <Field label={isNew ? 'PIN' : 'PIN nuevo'} hint={isNew ? '4 a 6 números' : 'dejalo vacío para no cambiarlo'}>
                <Input type="password" inputMode="numeric" autoComplete="new-password" value={editing.pin ?? ''} onChange={(e) => setEditing({ ...editing, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
              </Field>
              <Field label="Repetí el PIN">
                <Input type="password" inputMode="numeric" autoComplete="new-password" value={editing.pin2 ?? ''} onChange={(e) => setEditing({ ...editing, pin2: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
              </Field>
            </div>
            <p className="small muted">{ROLE_HELP[editing.role]}</p>
            <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Permisos</legend>
              {PERMISSIONS.map((p) => (
                <label key={p} className="check small" style={{ minHeight: 36 }}>
                  <input type="checkbox" checked={editing.permissions.includes(p)} onChange={(e) => setPerm(p, e.target.checked)} />
                  {PERMISSION_LABEL[p]}
                </label>
              ))}
            </fieldset>
            <label className="check"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Usuario activo (puede entrar)</label>
          </form>
        )}
      </Modal>
      <p className="small muted" style={{ marginTop: 12 }} role="note"><UserCog size={14} aria-hidden style={{ verticalAlign: 'middle' }} /> El PIN protege el acceso en este dispositivo. Si la app está vinculada a la nube, los usuarios se comparten con los demás dispositivos del negocio.</p>
    </>
  );
}

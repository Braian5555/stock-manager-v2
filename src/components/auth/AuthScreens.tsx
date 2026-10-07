import { ArrowLeft, Cloud, Lock } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../store/session';
import { useSettings } from '../../store/settings';
import { useFeedback } from '../../store/feedback';
import { PIN_RE } from '../../services/userService';
import { Logo } from '../Logo';
import { Field, Input } from '../ui';
import { PinPad } from './PinPad';
import { UserAvatar } from './UserAvatar';
import { CloudPage } from '../../pages/CloudPage';

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  const settings = useSettings();
  return (
    <div className="auth-shell">
      <div className={`auth-card card ${wide ? 'wide' : ''}`}>
        <div className="row" style={{ justifyContent: 'center', gap: 10, marginBottom: 8 }}>
          <Logo size={40} />
          <div>
            <div className="brand-name">{settings.businessName}</div>
            {settings.subtitle && <div className="brand-sub">{settings.subtitle}</div>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Primer uso: crear el usuario administrador (o traer los usuarios desde la nube). */
export function SetupScreen() {
  const { createFirstAdmin } = useSession();
  const { run, notify } = useFeedback();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [cloud, setCloud] = useState(false);

  if (cloud)
    return (
      <Shell wide>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCloud(false)}><ArrowLeft size={16} aria-hidden /> Volver</button>
        <CloudPage />
      </Shell>
    );

  const submit = async () => {
    if (!name.trim()) return notify('Ingresá tu nombre.', { tone: 'error' });
    if (!PIN_RE.test(pin)) return notify('El PIN debe tener entre 4 y 6 números.', { tone: 'error' });
    if (pin !== pin2) return notify('Los PIN no coinciden.', { tone: 'error' });
    await run(() => createFirstAdmin(name, pin), 'Usuario creado. ¡Bienvenido!');
  };

  return (
    <Shell>
      <h1 style={{ textAlign: 'center' }}>Crear usuario administrador</h1>
      <p className="muted small" style={{ textAlign: 'center' }}>Es el primer usuario. Después vas a poder crear usuarios para cada persona, con sus permisos.</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Tu nombre"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-autofocus maxLength={40} /></Field>
        <Field label="PIN" hint="4 a 6 números"><Input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
        <Field label="Repetí el PIN"><Input type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
        <button type="submit" className="btn btn-primary btn-block">Crear y entrar</button>
      </form>
      <hr className="sep" />
      <button type="button" className="btn btn-block" onClick={() => setCloud(true)}><Cloud size={18} aria-hidden /> Ya usamos Stock Manager en la nube</button>
      <p className="small muted" style={{ textAlign: 'center', marginTop: 8 }}>Iniciá sesión con la cuenta de Google del negocio para traer los datos y los usuarios.</p>
    </Shell>
  );
}

/** Pantalla de bloqueo: elegir usuario e ingresar el PIN. */
export function LockScreen() {
  const { users, login } = useSession();
  const active = users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const [selected, setSelected] = useState<string | null>(active.length === 1 ? active[0].id : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const user = active.find((u) => u.id === selected);

  const submit = async () => {
    if (!user || busy) return;
    setBusy(true);
    setError('');
    try {
      await login(user.id, pin);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo entrar.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      {!user ? (
        <>
          <h1 style={{ textAlign: 'center' }} className="row"><Lock size={20} aria-hidden /> ¿Quién sos?</h1>
          <div className="user-grid" role="list">
            {active.map((u) => (
              <button key={u.id} type="button" role="listitem" className="user-tile" onClick={() => { setSelected(u.id); setPin(''); setError(''); }}>
                <UserAvatar user={u} size={52} />
                <span className="truncate">{u.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="stack" style={{ alignItems: 'center' }}>
          <UserAvatar user={user} size={64} />
          <h1>{user.name}</h1>
          <p className="muted small">Ingresá tu PIN</p>
          <PinPad value={pin} onChange={(v) => { setPin(v); setError(''); }} onSubmit={submit} disabled={busy} />
          {error && <p role="alert" className="small" style={{ color: 'var(--out)', textAlign: 'center' }}>{error}</p>}
          {active.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSelected(null); setPin(''); setError(''); }}><ArrowLeft size={16} aria-hidden /> Cambiar de usuario</button>}
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHelp((h) => !h)} aria-expanded={help}>¿Olvidaste tu PIN?</button>
        {help && <p className="small muted">Pedile a un administrador que te asigne un PIN nuevo desde <b>Usuarios</b>. Si sos el único administrador y olvidaste tu PIN, restaurá una copia de seguridad o pedí ayuda a quien administra la cuenta de Google del negocio.</p>}
      </div>
    </Shell>
  );
}

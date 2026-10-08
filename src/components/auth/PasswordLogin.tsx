import { LogIn, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { sendPasswordReset, signInWithPassword, signUpWithPassword } from '../../cloud/cloudService';
import { useFeedback } from '../../store/feedback';
import { Field, Input } from '../ui';

/** Formulario de la cuenta de la nube: entrar, crear cuenta u olvidé mi contraseña. */
export function PasswordLogin() {
  const { notify } = useFeedback();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    act(async () => {
      if (mode === 'login') return signInWithPassword(email, password);
      if (password !== password2) throw new Error('Las contraseñas no coinciden.');
      await signUpWithPassword(email, password, name);
    });

  const reset = () =>
    act(async () => {
      await sendPasswordReset(email);
      notify('Te enviamos un email para elegir una contraseña nueva (revisá también spam).');
    });

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-busy={busy}>
      {mode === 'signup' && (
        <Field label="Tu nombre"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} /></Field>
      )}
      <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" data-autofocus /></Field>
      <Field label="Contraseña" hint={mode === 'signup' ? 'al menos 6 caracteres' : undefined}>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
      </Field>
      {mode === 'signup' && (
        <Field label="Repetí la contraseña"><Input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" /></Field>
      )}
      {error && <p role="alert" className="small" style={{ color: 'var(--out)', margin: 0 }}>{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {mode === 'login' ? <><LogIn size={18} aria-hidden /> Entrar</> : <><UserPlus size={18} aria-hidden /> Crear cuenta</>}
      </button>
      {mode === 'login' ? (
        <div className="row wrap between">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode('signup'); setError(''); }}>Crear una cuenta</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reset()}>Olvidé mi contraseña</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode('login'); setError(''); }}>Ya tengo cuenta</button>
      )}
    </form>
  );
}

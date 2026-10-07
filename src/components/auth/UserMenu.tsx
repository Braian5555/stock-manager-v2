import { Lock, UserCog } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../../store/session';
import { ROLE_LABEL } from '../../services/userService';
import { UserAvatar } from './UserAvatar';

/** Usuario actual con acceso rápido a "Bloquear" (cambiar de usuario). */
export function UserMenu() {
  const { user, lock, can } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="user-chip" aria-haspopup="menu" aria-expanded={open} aria-label={`Usuario: ${user.name}`} onClick={() => setOpen((o) => !o)}>
        <UserAvatar user={user} size={28} />
        <span className="truncate" style={{ maxWidth: 110 }}>{user.name}</span>
      </button>
      {open && (
        <div role="menu" className="card" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 220, padding: 6 }}>
          <div className="small muted" style={{ padding: '6px 10px' }}>{ROLE_LABEL[user.role]}</div>
          {can('admin') && (
            <Link role="menuitem" to="/usuarios" className="btn btn-ghost btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => setOpen(false)}>
              <UserCog size={18} aria-hidden /> Usuarios
            </Link>
          )}
          <button role="menuitem" type="button" className="btn btn-ghost btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => void lock()}>
            <Lock size={18} aria-hidden /> Bloquear / cambiar usuario
          </button>
        </div>
      )}
    </div>
  );
}

import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload } from 'lucide-react';
import { Link } from 'react-router';
import { useCloud } from '../cloud/cloudService';

const VIEW = {
  synced: { icon: CloudCheck, label: 'Sincronizado', tone: 'ok' },
  pending: { icon: CloudUpload, label: 'Enviando cambios…', tone: 'info' },
  connecting: { icon: Cloud, label: 'Conectando…', tone: 'info' },
  offline: { icon: CloudOff, label: 'Sin conexión: se envía al volver', tone: 'warn' },
  error: { icon: CloudAlert, label: 'Error de sincronización', tone: 'error' },
  idle: { icon: Cloud, label: 'Nube', tone: '' },
} as const;

/** Estado de la sincronización. `compact`: sólo icono (barra superior). */
export function SyncBadge({ compact }: { compact?: boolean }) {
  const cloud = useCloud();
  if (cloud.phase !== 'linked') return null;
  const v = VIEW[cloud.status.state];
  const Icon = v.icon;
  const text = cloud.status.pending > 0 && cloud.status.state !== 'offline' ? `${v.label} (${cloud.status.pending})` : cloud.status.state === 'offline' && cloud.status.pending ? `Sin conexión: ${cloud.status.pending} cambios por enviar` : v.label;
  if (compact)
    return (
      <Link to="/nube" className={`btn btn-ghost icon-btn sync-${cloud.status.state}`} aria-label={text} title={text}>
        <Icon size={20} aria-hidden />
      </Link>
    );
  return (
    <span className={`badge badge-${v.tone}`}>
      <Icon size={14} aria-hidden /> {text}
    </span>
  );
}

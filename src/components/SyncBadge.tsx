import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Link } from 'react-router';
import { useCloud, type CloudState } from '../cloud/cloudService';
import { useOnline } from '../hooks/useData';
import { useSession } from '../store/session';

export type SyncView = { key: string; icon: typeof Cloud; label: string; short: string; tone: 'ok' | 'info' | 'warn' | 'error' | 'muted'; detail?: string };

/**
 * Estado de conexión y sincronización en una sola lectura:
 * En línea · Sin conexión · Sincronizando · Sincronizado · Cambios pendientes · Error.
 */
export function syncView(cloud: CloudState, online: boolean): SyncView {
  const pending = cloud.status.pending;
  if (cloud.phase !== 'linked') {
    return online
      ? { key: 'online', icon: Wifi, label: 'En línea · sin nube', short: 'En línea', tone: 'muted', detail: 'Los datos se guardan sólo en este dispositivo.' }
      : { key: 'offline', icon: WifiOff, label: 'Sin conexión', short: 'Sin conexión', tone: 'warn', detail: 'Podés seguir trabajando: todo se guarda en este dispositivo.' };
  }
  const s = cloud.status.state;
  if (!online || s === 'offline')
    return pending > 0
      ? { key: 'offline-pending', icon: CloudOff, label: `Sin conexión · ${pending} ${pending === 1 ? 'cambio pendiente' : 'cambios pendientes'}`, short: `${pending} pendientes`, tone: 'warn', detail: 'Se envían solos al volver la conexión.' }
      : { key: 'offline', icon: CloudOff, label: 'Sin conexión', short: 'Sin conexión', tone: 'warn', detail: 'Podés seguir trabajando: se sincroniza al volver.' };
  if (s === 'error') return { key: 'error', icon: CloudAlert, label: 'Error de sincronización', short: 'Error', tone: 'error', detail: cloud.status.error };
  if (s === 'connecting') return { key: 'syncing', icon: RefreshCw, label: 'Sincronizando…', short: 'Sincronizando', tone: 'info' };
  if (s === 'pending' || pending > 0)
    return { key: 'pending', icon: CloudUpload, label: `Enviando ${pending || ''} ${pending === 1 ? 'cambio' : 'cambios'}…`.replace('  ', ' '), short: pending ? `${pending} pendientes` : 'Enviando', tone: 'info' };
  if (s === 'synced') return { key: 'synced', icon: CloudCheck, label: 'Sincronizado', short: 'Sincronizado', tone: 'ok' };
  return { key: 'idle', icon: Cloud, label: 'Nube conectada', short: 'Nube', tone: 'muted' };
}

export function useSyncView(): SyncView {
  return syncView(useCloud(), useOnline());
}

/**
 * Indicador siempre visible. `compact`: icono + texto corto (celular); si no, texto completo.
 * Lleva a Cuenta y nube.
 */
export function SyncBadge({ compact }: { compact?: boolean }) {
  const v = useSyncView();
  const { can } = useSession();
  const Icon = v.icon;
  const body = (
    <>
      <Icon size={16} aria-hidden className={v.key === 'syncing' ? 'spin-icon' : undefined} />
      <span className="sync-text">{compact ? v.short : v.label}</span>
    </>
  );
  const cls = `sync-pill sync-${v.tone} ${compact ? 'compact' : ''}`;
  const title = v.detail ? `${v.label}. ${v.detail}` : v.label;
  return can('admin') ? (
    <Link to="/nube" className={cls} aria-label={`Estado: ${v.label}`} title={title}>{body}</Link>
  ) : (
    <span className={cls} role="status" aria-label={`Estado: ${v.label}`} title={title}>{body}</span>
  );
}

import { useEffect } from 'react';
import { useIntegration } from './useData';
import { syncNow, syncPending } from '../integrations/integrationService';

/**
 * Sincronización automática MIENTRAS LA APP ESTÁ ABIERTA (cada 15/30/60 min) y
 * reintento de pendientes al recuperar la conexión. No depende de procesos en
 * segundo plano del navegador: para sincronización real 24/7 se requiere backend.
 */
export function useAutoSync() {
  const integ = useIntegration();
  const active = !!integ && (integ.mode === 'mock' || integ.mode === 'gateway') && (integ.status === 'conectado' || integ.status === 'error');
  const minutes = integ?.syncInterval === 'manual' ? 0 : Number(integ?.syncInterval ?? 0);

  useEffect(() => {
    if (!active) return;
    const onOnline = () => void syncPending().catch(() => undefined);
    window.addEventListener('online', onOnline);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (minutes > 0) timer = setInterval(() => navigator.onLine && void syncNow().catch(() => undefined), minutes * 60_000);
    return () => {
      window.removeEventListener('online', onOnline);
      if (timer) clearInterval(timer);
    };
  }, [active, minutes]);
}

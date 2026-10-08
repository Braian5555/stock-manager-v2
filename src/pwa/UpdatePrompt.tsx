import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Estrategia de actualización:
 * 1. El SW nuevo se descarga en segundo plano (precache versionado por hash).
 * 2. Queda "en espera" y se muestra este aviso. No reemplaza archivos a mitad de uso.
 * 3. Al tocar "Actualizar" se activa (skipWaiting) y la página se recarga una sola vez.
 * 4. Se buscan actualizaciones al abrir y cada 60 minutos mientras la app está abierta.
 */
let updateTimer: ReturnType<typeof setInterval> | undefined;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // El aviso se monta cada vez que se desbloquea la app: un solo temporizador para toda la sesión.
      if (!registration || updateTimer) return;
      updateTimer = setInterval(() => {
        if (navigator.onLine) registration.update().catch(() => undefined);
      }, 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="banner banner-update" role="status">
      <RefreshCw size={16} aria-hidden />
      <span className="grow">Hay una nueva versión disponible.</span>
      <button type="button" className="btn btn-sm" onClick={() => setNeedRefresh(false)}>
        Más tarde
      </button>
      <button type="button" className="btn btn-sm" onClick={() => updateServiceWorker(true)}>
        Actualizar
      </button>
    </div>
  );
}

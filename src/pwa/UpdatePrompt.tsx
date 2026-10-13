import { RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Estrategia de actualización:
 * 1. El SW nuevo se descarga en segundo plano (precache versionado por hash).
 * 2. Queda "en espera" y se muestra este aviso; "Actualizar" lo aplica en el momento.
 * 3. Si nadie toca el aviso, se aplica solo cuando no interrumpe: al salir de la app (pestaña
 *    oculta) o tras un rato sin ninguna ventana ni campo abierto. Así ningún dispositivo queda
 *    semanas con una versión vieja, y nunca se pierde lo que se está escribiendo.
 * 4. Se buscan actualizaciones al abrir, al volver a la app y cada 60 minutos.
 */
let updateTimer: ReturnType<typeof setInterval> | undefined;
let swRegistration: ServiceWorkerRegistration | undefined;

/** Momento seguro para recargar: nada abierto ni a medio escribir. */
function isIdle(): boolean {
  if (document.querySelector('[role="dialog"]')) return false;
  const el = document.activeElement as HTMLElement | null;
  return !(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

const AUTO_APPLY_AFTER_MS = 2 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // El aviso se monta cada vez que se desbloquea la app: un solo temporizador para toda la sesión.
      if (!registration || updateTimer) return;
      swRegistration = registration;
      updateTimer = setInterval(() => {
        if (navigator.onLine) registration.update().catch(() => undefined);
      }, 60 * 60 * 1000);
    },
  });

  // Al volver a la app (desbloquear el celular, cambiar de pestaña) se busca una versión nueva.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) swRegistration?.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Aplicación automática cuando no molesta.
  const since = useRef<number | null>(null);
  useEffect(() => {
    if (!needRefresh) {
      since.current = null;
      return;
    }
    since.current ??= Date.now();
    const apply = () => void updateServiceWorker(true);
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && isIdle()) apply();
    };
    const timer = setInterval(() => {
      if (since.current && Date.now() - since.current >= AUTO_APPLY_AFTER_MS && isIdle()) apply();
    }, 15_000);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [needRefresh, updateServiceWorker]);

  if (!needRefresh) return null;
  return (
    <div className="banner banner-update" role="status">
      <RefreshCw size={16} aria-hidden />
      <span className="grow">Hay una nueva versión disponible. Se instala sola en un momento, o tocá Actualizar.</span>
      <button type="button" className="btn btn-sm" onClick={() => setNeedRefresh(false)}>
        Más tarde
      </button>
      <button type="button" className="btn btn-sm" onClick={() => updateServiceWorker(true)}>
        Actualizar
      </button>
    </div>
  );
}

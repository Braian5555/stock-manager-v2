const KEY = 'sm:chunk-reload-at';

/** Error típico al pedir un archivo de la app con el nombre de una versión anterior. */
export const isChunkLoadError = (e: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk|Unable to preload CSS/i.test(
    e instanceof Error ? e.message : String(e),
  );

/**
 * Si la app se actualizó mientras estaba abierta (o el navegador guardó una versión vieja), los
 * archivos viejos ya no están en el servidor y una pantalla (o el inicio de sesión) "no entra".
 * En ese caso se recarga una vez —como mucho cada 30 s, para no entrar en un bucle— y se toma la
 * versión nueva. Devuelve true si va a recargar.
 */
export function reloadForNewVersion(e: unknown): boolean {
  if (!isChunkLoadError(e) || navigator.onLine === false) return false;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    /* sin sessionStorage */
  }
  if (Date.now() - last <= 30_000) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* sin sessionStorage */
  }
  location.reload();
  return true;
}

/** Cualquier archivo que no carga por ser de una versión anterior (también los que Vite precarga). */
export function installChunkReload() {
  window.addEventListener('vite:preloadError', (ev) => {
    if (reloadForNewVersion((ev as Event & { payload?: unknown }).payload)) ev.preventDefault();
  });
  window.addEventListener('unhandledrejection', (ev) => {
    if (reloadForNewVersion(ev.reason)) ev.preventDefault();
  });
}

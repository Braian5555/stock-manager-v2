import { lazy, type ComponentType } from 'react';

const KEY = 'sm:chunk-reload-at';

/** Error típico al pedir una pantalla con el nombre de archivo de una versión anterior. */
export const isChunkLoadError = (e: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i.test(
    e instanceof Error ? e.message : String(e),
  );

/**
 * Pantalla que se descarga al entrar. Si la app se actualizó mientras estaba abierta, el archivo
 * viejo ya no existe en el servidor y la pantalla "no entra": en ese caso se recarga una vez
 * (como mucho cada 30 s, para no entrar en un bucle) y se toma la versión nueva.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cualquier componente de página
export function lazyPage<K extends string, M extends Record<K, ComponentType<any>>>(loader: () => Promise<M>, name: K) {
  return lazy<M[K]>(() =>
    loader()
      .then((m) => ({ default: m[name] }))
      .catch((e: unknown) => {
        let last = 0;
        try {
          last = Number(sessionStorage.getItem(KEY) ?? 0);
        } catch {
          /* sin sessionStorage */
        }
        if (isChunkLoadError(e) && navigator.onLine !== false && Date.now() - last > 30_000) {
          try {
            sessionStorage.setItem(KEY, String(Date.now()));
          } catch {
            /* sin sessionStorage */
          }
          location.reload();
          return new Promise<{ default: M[K] }>(() => undefined); // la página se recarga
        }
        throw e;
      }),
  );
}

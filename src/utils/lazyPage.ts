import { lazy, type ComponentType } from 'react';
import { reloadForNewVersion } from './chunkReload';

export { isChunkLoadError } from './chunkReload';

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
        if (reloadForNewVersion(e)) return new Promise<{ default: M[K] }>(() => undefined); // la página se recarga
        throw e;
      }),
  );
}

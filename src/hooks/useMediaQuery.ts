import { useSyncExternalStore } from 'react';

/** true mientras la media query se cumple (se actualiza al girar o cambiar el tamaño de la ventana). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** Mismo corte que el CSS: desde 1024 px se muestra el menú lateral (computadora). */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/** Abre el buscador general desde cualquier pantalla. */
export const openGlobalSearch = () => window.dispatchEvent(new Event('sm:open-search'));

import { useEffect, useRef, useState } from 'react';

/**
 * Listas largas: se dibujan de a tandas para que la pantalla aparezca enseguida aunque haya
 * miles de registros. Al acercarse al final se agrega la tanda siguiente sola (o con el botón,
 * por accesibilidad). La búsqueda y los filtros trabajan siempre sobre la lista completa;
 * cuando cambian (`resetKey`), se vuelve a la primera tanda.
 */
export function useIncremental<T>(items: T[], resetKey: unknown, step = 60) {
  const [count, setCount] = useState(step);
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    // Ajuste de estado durante el render (patrón recomendado por React para "resetear al cambiar").
    setLastKey(resetKey);
    setCount(step);
  }
  const visible = items.length > count ? items.slice(0, count) : items;
  const remaining = items.length - visible.length;
  const more = () => setCount((c) => c + step * 2);
  return { visible, remaining, more, sentinel: <LoadMore remaining={remaining} onMore={more} /> };
}

function LoadMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || remaining <= 0 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onMore(), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [remaining, onMore]);
  if (remaining <= 0) return null;
  return (
    <div ref={ref} className="load-more">
      <button type="button" className="btn btn-ghost btn-sm" onClick={onMore}>Mostrar más ({remaining} restantes)</button>
    </div>
  );
}

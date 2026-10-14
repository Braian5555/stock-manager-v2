import { useEffect, useState } from 'react';
import { localYmd } from '../utils/format';

/**
 * Fecha de hoy (YYYY-MM-DD local) que cambia sola a la medianoche. Las pantallas que quedan
 * abiertas toda la noche (la tablet de producción) pasan al día nuevo sin recargar.
 */
export function useToday(): string {
  const [today, setToday] = useState(localYmd);
  useEffect(() => {
    const check = () => setToday((cur) => (cur === localYmd() ? cur : localYmd()));
    const id = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}

/** Inicio del día local (ISO) para una fecha YYYY-MM-DD. */
export function startOfDayIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

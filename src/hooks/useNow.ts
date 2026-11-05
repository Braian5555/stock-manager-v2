import { useEffect, useState } from 'react';

/** La hora actual, refrescada cada `every` ms (para los "hace 12 min"). */
export function useNow(every = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [every]);
  return now;
}

/** "recién", "8 min", "1 h 20". */
export function sinceLabel(iso: string | undefined, now: number): string {
  if (!iso) return '';
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'recién';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
}

export const minutesSince = (iso: string | undefined, now: number) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 60_000) : 0);

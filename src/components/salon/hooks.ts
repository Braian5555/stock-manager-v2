import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { EMPTY } from '../../hooks/useData';
import type { CashSession, DiningTable, MenuItem, TableTicket } from '../../models';
import { inLocal, useLocalScope } from '../../services/localScope';

/** Id del local del equipo (para volver a consultar cuando cambia). */
const useLid = () => useLocalScope().current?.id;
// Todo lo del Salón es del local del equipo (mesas, carta, pedidos y caja).
export const useTables = () => { const lid = useLid(); return (useLiveQuery(() => db.diningTables.orderBy('order').filter((t) => t.active && inLocal(t)).toArray(), [lid]) ?? EMPTY) as DiningTable[]; };
export const useMenu = () => { const lid = useLid(); return (useLiveQuery(() => db.menuItems.orderBy('name').filter(inLocal).toArray(), [lid]) ?? EMPTY) as MenuItem[]; };
export const useOpenTickets = () => { const lid = useLid(); return (useLiveQuery(() => db.tickets.where('status').anyOf('abierta', 'cuenta').filter(inLocal).toArray(), [lid]) ?? EMPTY) as TableTicket[]; };
/** La caja abierta (null si no hay; undefined mientras carga). */
export const useOpenCash = () => { const lid = useLid(); return useLiveQuery(async () => (await db.cashSessions.where('status').equals('abierta').filter(inLocal).first()) ?? null, [lid]) as CashSession | null | undefined; };

/** Los platos más pedidos de las últimas 2 semanas (para tenerlos a mano al tomar el pedido). */
export function useTopItems(limit = 12): string[] {
  const lid = useLid();
  return useLiveQuery(async () => {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const count = new Map<string, number>();
    await db.tickets.where('openedAt').aboveOrEqual(since).filter(inLocal).each((t) => {
      for (const l of t.lines) if (l.qty > 0 && !l.custom) count.set(l.menuItemId, (count.get(l.menuItemId) ?? 0) + l.qty);
    });
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  }, [limit, lid]) ?? (EMPTY as string[]);
}

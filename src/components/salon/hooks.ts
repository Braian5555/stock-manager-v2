import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { EMPTY } from '../../hooks/useData';
import type { CashSession, DiningTable, MenuItem, TableTicket } from '../../models';

export const useTables = () => (useLiveQuery(() => db.diningTables.orderBy('order').filter((t) => t.active).toArray(), []) ?? EMPTY) as DiningTable[];
export const useMenu = () => (useLiveQuery(() => db.menuItems.orderBy('name').toArray(), []) ?? EMPTY) as MenuItem[];
export const useOpenTickets = () => (useLiveQuery(() => db.tickets.where('status').anyOf('abierta', 'cuenta').toArray(), []) ?? EMPTY) as TableTicket[];
/** La caja abierta (null si no hay; undefined mientras carga). */
export const useOpenCash = () => useLiveQuery(async () => (await db.cashSessions.where('status').equals('abierta').first()) ?? null, []) as CashSession | null | undefined;

/** Los platos más pedidos de las últimas 2 semanas (para tenerlos a mano al tomar el pedido). */
export function useTopItems(limit = 12): string[] {
  return useLiveQuery(async () => {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const count = new Map<string, number>();
    await db.tickets.where('openedAt').aboveOrEqual(since).each((t) => {
      for (const l of t.lines) if (l.qty > 0 && !l.custom) count.set(l.menuItemId, (count.get(l.menuItemId) ?? 0) + l.qty);
    });
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  }, [limit]) ?? (EMPTY as string[]);
}

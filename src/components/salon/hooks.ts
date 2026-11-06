import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { EMPTY } from '../../hooks/useData';
import type { CashSession, DiningTable, MenuItem, TableTicket } from '../../models';

export const useTables = () => (useLiveQuery(() => db.diningTables.orderBy('order').filter((t) => t.active).toArray(), []) ?? EMPTY) as DiningTable[];
export const useMenu = () => (useLiveQuery(() => db.menuItems.orderBy('name').toArray(), []) ?? EMPTY) as MenuItem[];
export const useOpenTickets = () => (useLiveQuery(() => db.tickets.where('status').anyOf('abierta', 'cuenta').toArray(), []) ?? EMPTY) as TableTicket[];
/** La caja abierta (null si no hay; undefined mientras carga). */
export const useOpenCash = () => useLiveQuery(async () => (await db.cashSessions.where('status').equals('abierta').first()) ?? null, []) as CashSession | null | undefined;

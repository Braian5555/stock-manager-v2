/**
 * Caja (estilo Fudo): turnos con arqueo.
 *  - Se abre con el efectivo inicial. Cada cobro de la cuenta queda en la caja abierta.
 *  - Durante el turno: ingresos y egresos (p. ej. pago a un proveedor en efectivo).
 *  - Se cierra contando cada medio de pago: queda la diferencia (sobrante o faltante).
 *  - Una caja cerrada no se reabre.
 * Si se cobra sin caja abierta, ese cobro entra en la próxima caja que se abra.
 */
import { db } from '../database/db';
import type { CashMovement, CashSession, SalePaymentMethod, TableTicket, TicketCharge } from '../models';
import { nowIso, uuid } from '../utils/id';
import { getCurrentActor } from './userService';

export const METHODS: SalePaymentMethod[] = ['efectivo', 'debito', 'credito', 'transferencia', 'qr', 'otro'];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const actor = () => {
  const a = getCurrentActor();
  return a ? { id: a.id, name: a.name } : undefined;
};

export async function openSession(): Promise<CashSession | undefined> {
  return db.cashSessions.where('status').equals('abierta').first();
}

/** Cobros de la cuenta (con sus pedidos) que pertenecen a una caja. */
export function chargesOf(tickets: TableTicket[], sessionId: string): { ticket: TableTicket; charge: TicketCharge }[] {
  const out: { ticket: TableTicket; charge: TicketCharge }[] = [];
  // Una venta anulada (con permiso, mientras la caja seguía abierta) ya no cuenta en la caja.
  for (const t of tickets) if (t.status !== 'anulada') for (const c of t.charges ?? []) if (c.cashSessionId === sessionId) out.push({ ticket: t, charge: c });
  return out.sort((a, b) => a.charge.at.localeCompare(b.charge.at));
}

export interface CashSummary {
  sales: Record<SalePaymentMethod, number>;
  tips: Record<SalePaymentMethod, number>;
  ingresos: Record<SalePaymentMethod, number>;
  egresos: Record<SalePaymentMethod, number>;
  /** Lo que tendría que haber, por medio de pago (efectivo incluye el inicial). */
  expected: Record<SalePaymentMethod, number>;
  totalSales: number;
  totalTips: number;
  count: number;
  /** Cargado a cuenta corriente en esta caja (no es plata: no entra en el arqueo). */
  onAccount: number;
  /** Invitaciones / consumo interno (cerrado sin cobrar). */
  invitations: number;
}

const zero = () => Object.fromEntries(METHODS.map((m) => [m, 0])) as Record<SalePaymentMethod, number>;

export function summarize(session: CashSession, tickets: TableTicket[], movements: CashMovement[]): CashSummary {
  const sales = zero();
  const tips = zero();
  const ingresos = zero();
  const egresos = zero();
  let onAccount = 0, invitations = 0;
  const charges = chargesOf(tickets, session.id);
  for (const { charge } of charges) {
    for (const p of charge.payments) {
      if (p.method === 'cuenta_corriente') onAccount = round2(onAccount + p.amount);
      else if (p.method === 'invitacion') invitations = round2(invitations + p.amount);
      else if (p.method in sales) sales[p.method] = round2(sales[p.method] + p.amount);
    }
    if (charge.tip?.amount && charge.tip.method in tips) tips[charge.tip.method] = round2(tips[charge.tip.method] + charge.tip.amount);
  }
  for (const m of movements.filter((x) => x.sessionId === session.id)) {
    const bag = m.kind === 'ingreso' ? ingresos : egresos;
    if (m.method in bag) bag[m.method] = round2(bag[m.method] + m.amount);
  }
  const expected = zero();
  for (const k of METHODS) expected[k] = round2(sales[k] + tips[k] + ingresos[k] - egresos[k] + (k === 'efectivo' ? session.initialCash : 0));
  return {
    sales, tips, ingresos, egresos, expected,
    totalSales: round2(METHODS.reduce((s, k) => s + sales[k], 0)),
    totalTips: round2(METHODS.reduce((s, k) => s + tips[k], 0)),
    count: charges.length,
    onAccount, invitations,
  };
}

/** Abre la caja. Los cobros hechos sin caja desde el último cierre entran en esta. */
export async function openCash(initialCash: number, register = 'Caja'): Promise<CashSession> {
  if (!Number.isFinite(initialCash) || initialCash < 0) throw new Error('El efectivo inicial no es válido.');
  return db.transaction('rw', db.cashSessions, db.tickets, async () => {
    if (await openSession()) throw new Error('Ya hay una caja abierta: cerrala antes de abrir otra.');
    const all = await db.cashSessions.toArray();
    const lastClose = all.filter((s) => s.closedAt).map((s) => s.closedAt!).sort().at(-1) ?? '';
    const t = nowIso();
    const by = actor();
    const s: CashSession = {
      id: uuid(), createdAt: t, updatedAt: t,
      number: all.reduce((m, x) => Math.max(m, x.number), 0) + 1,
      register: register.trim() || 'Caja', openedAt: t, ...(by ? { openedBy: by } : {}),
      initialCash: round2(initialCash), status: 'abierta',
    };
    await db.cashSessions.add(s);
    // Cobros sin caja (desde el último cierre): pasan a esta caja.
    const orphans = await db.tickets.filter((x) => (x.charges ?? []).some((c) => !c.cashSessionId && c.at > lastClose)).toArray();
    for (const tk of orphans) {
      await db.tickets.put({ ...tk, charges: tk.charges!.map((c) => (!c.cashSessionId && c.at > lastClose ? { ...c, cashSessionId: s.id } : c)), updatedAt: t });
    }
    return s;
  });
}

export async function addMovement(kind: 'ingreso' | 'egreso', amount: number, reason: string, method: SalePaymentMethod = 'efectivo', account?: { id: string; name: string }): Promise<CashMovement> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Poné un importe mayor a cero.');
  if (!METHODS.includes(method)) throw new Error('Los movimientos de caja tienen que ser con plata (no cuenta corriente ni invitación).');
  if (!reason.trim()) throw new Error(kind === 'egreso' ? 'Poné en qué se gastó.' : 'Poné de qué es el ingreso.');
  const s = await openSession();
  if (!s) throw new Error('No hay una caja abierta.');
  const t = nowIso();
  const by = actor();
  const m: CashMovement = { id: uuid(), createdAt: t, updatedAt: t, sessionId: s.id, at: t, kind, amount: round2(amount), method, reason: reason.trim(), ...(by ? { by } : {}), ...(account ? { accountId: account.id, accountName: account.name } : {}) };
  await db.cashMovements.add(m);
  return m;
}

/** Cierra la caja con lo contado por medio de pago. No se puede reabrir. */
export async function closeCash(sessionId: string, counted: Partial<Record<SalePaymentMethod, number>>, note?: string): Promise<CashSession> {
  const s = await db.cashSessions.get(sessionId);
  if (!s) throw new Error('La caja no existe.');
  if (s.status === 'cerrada') throw new Error('Esa caja ya está cerrada.');
  const tickets = await db.tickets.filter((x) => (x.charges ?? []).some((c) => c.cashSessionId === sessionId)).toArray();
  const movements = await db.cashMovements.where('sessionId').equals(sessionId).toArray();
  const sum = summarize(s, tickets, movements);
  const clean: Partial<Record<SalePaymentMethod, number>> = {};
  for (const k of METHODS) {
    const v = counted[k];
    if (v !== undefined) {
      if (!Number.isFinite(v) || v < 0) throw new Error('Revisá los importes contados.');
      clean[k] = round2(v);
    }
  }
  const t = nowIso();
  const by = actor();
  const closed: CashSession = {
    ...s, status: 'cerrada', closedAt: t, ...(by ? { closedBy: by } : {}),
    expected: Object.fromEntries(METHODS.filter((k) => sum.expected[k] !== 0 || clean[k] !== undefined).map((k) => [k, sum.expected[k]])),
    counted: clean, ...(note?.trim() ? { note: note.trim() } : {}), updatedAt: t,
  };
  await db.cashSessions.put(closed);
  return closed;
}

/** Diferencia por medio (contado − esperado). Lo no contado se toma igual a lo esperado. */
export function differences(s: Pick<CashSession, 'expected' | 'counted'>): { method: SalePaymentMethod; expected: number; counted: number; diff: number }[] {
  return METHODS.filter((k) => (s.expected?.[k] ?? 0) !== 0 || s.counted?.[k] !== undefined).map((k) => {
    const expected = s.expected?.[k] ?? 0;
    const counted = s.counted?.[k] ?? expected;
    return { method: k, expected, counted, diff: round2(counted - expected) };
  });
}

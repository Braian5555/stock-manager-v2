/**
 * Cuentas corrientes de clientes (ALADES, socios, huéspedes, personal…).
 *
 *  - Al cobrar una mesa se puede cargar todo o una parte a la cuenta de un cliente
 *    (medio "Cuenta corriente"): la mesa se cierra, pero esa plata NO entra en la caja.
 *  - Cuando el cliente paga, se registra la cobranza: ahí sí entra en la caja abierta,
 *    con su medio de pago (efectivo, transferencia…), como un ingreso de caja.
 *  - El saldo de cada cliente = lo cargado − lo pagado. Se calcula siempre a partir de los
 *    pedidos y los movimientos de caja (no se guarda aparte, así no se desincroniza).
 */
import { db } from '../database/db';
import type { CashMovement, CustomerAccount, DocTipo, SalePaymentMethod, TableTicket } from '../models';
import { nowIso, uuid } from '../utils/id';
import { addMovement, METHODS } from './cashService';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface AccountInput {
  name: string;
  docTipo?: DocTipo;
  docNro?: string;
  condicionIva?: number;
  notes?: string;
  active?: boolean;
}

export async function saveAccount(input: AccountInput, id?: string): Promise<CustomerAccount> {
  const name = input.name.trim();
  if (!name) throw new Error('Poné el nombre del cliente.');
  const all = await db.accounts.toArray();
  if (all.some((a) => a.id !== id && a.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`Ya hay un cliente "${name}".`);
  const t = nowIso();
  const prev = id ? await db.accounts.get(id) : undefined;
  const docNro = input.docNro?.replace(/\D/g, '') || undefined;
  const a: CustomerAccount = {
    id: prev?.id ?? uuid(), createdAt: prev?.createdAt ?? t, updatedAt: t,
    name, active: input.active ?? prev?.active ?? true,
    ...(docNro ? { docNro, docTipo: input.docTipo ?? (docNro.length === 11 ? 80 : 96) } : {}),
    ...(input.condicionIva ? { condicionIva: input.condicionIva } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
  };
  await db.accounts.put(a);
  return a;
}

export async function setAccountActive(id: string, active: boolean): Promise<void> {
  const a = await db.accounts.get(id);
  if (!a) throw new Error('El cliente no existe.');
  await db.accounts.put({ ...a, active, updatedAt: nowIso() });
}

/** Un renglón de la cuenta: cargo (mesa a cuenta corriente) o pago (cobranza). */
export interface LedgerEntry {
  at: string;
  kind: 'cargo' | 'pago';
  amount: number;
  label: string;
  ticketId?: string;
  movementId?: string;
  method?: SalePaymentMethod;
  by?: string;
}

/** Movimientos de una cuenta, del más viejo al más nuevo, con el saldo acumulado. */
export function ledger(accountId: string, tickets: TableTicket[], movements: CashMovement[]): (LedgerEntry & { balance: number })[] {
  const out: LedgerEntry[] = [];
  for (const t of tickets) {
    if (t.status === 'anulada') continue;
    for (const c of t.charges ?? []) {
      const amount = round2(c.payments.filter((p) => p.method === 'cuenta_corriente' && p.accountId === accountId).reduce((s, p) => s + p.amount, 0));
      if (amount > 0) out.push({ at: c.at, kind: 'cargo', amount, label: chargeLabel(t), ticketId: t.id, by: c.by?.name });
    }
  }
  for (const m of movements) {
    if (m.accountId !== accountId) continue;
    // Una cobranza es un ingreso; un egreso con cuenta es una devolución (resta lo pagado).
    out.push({ at: m.at, kind: 'pago', amount: m.kind === 'ingreso' ? m.amount : -m.amount, label: m.reason, movementId: m.id, method: m.method, by: m.by?.name });
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  let balance = 0;
  return out.map((e) => {
    balance = round2(balance + (e.kind === 'cargo' ? e.amount : -e.amount));
    return { ...e, balance };
  });
}

const chargeLabel = (t: TableTicket) => {
  const where = t.channel && t.channel !== 'mesa' ? (t.customer?.name ? `${t.tableName} · ${t.customer.name}` : t.tableName) : `Mesa ${t.tableName}`;
  return `${where} · pedido #${t.number}`;
};

export interface AccountBalance { account: CustomerAccount; charged: number; paid: number; balance: number; lastAt?: string }

/** Saldo de cada cliente (lo que debe). Ordenado: primero los que más deben. */
export function balances(accounts: CustomerAccount[], tickets: TableTicket[], movements: CashMovement[]): AccountBalance[] {
  const charged = new Map<string, number>();
  const paid = new Map<string, number>();
  const last = new Map<string, string>();
  const seen = (id: string, at: string) => { if ((last.get(id) ?? '') < at) last.set(id, at); };
  for (const t of tickets) {
    if (t.status === 'anulada') continue;
    for (const c of t.charges ?? []) for (const p of c.payments) {
      if (p.method !== 'cuenta_corriente' || !p.accountId) continue;
      charged.set(p.accountId, round2((charged.get(p.accountId) ?? 0) + p.amount));
      seen(p.accountId, c.at);
    }
  }
  for (const m of movements) {
    if (!m.accountId) continue;
    paid.set(m.accountId, round2((paid.get(m.accountId) ?? 0) + (m.kind === 'ingreso' ? m.amount : -m.amount)));
    seen(m.accountId, m.at);
  }
  return accounts
    .map((account) => {
      const c = charged.get(account.id) ?? 0;
      const p = paid.get(account.id) ?? 0;
      return { account, charged: c, paid: p, balance: round2(c - p), lastAt: last.get(account.id) };
    })
    .sort((a, b) => b.balance - a.balance || a.account.name.localeCompare(b.account.name, 'es'));
}

/**
 * Registra que un cliente pagó (toda o parte de su deuda). Entra en la caja abierta como
 * ingreso con su medio de pago: por eso hace falta una caja abierta.
 */
export async function recordAccountPayment(accountId: string, amount: number, method: SalePaymentMethod, note?: string): Promise<CashMovement> {
  const a = await db.accounts.get(accountId);
  if (!a) throw new Error('El cliente no existe.');
  if (!METHODS.includes(method)) throw new Error('El pago tiene que ser con plata (efectivo, transferencia…).');
  const reason = `Pago cuenta corriente · ${a.name}${note?.trim() ? ` · ${note.trim()}` : ''}`;
  return addMovement('ingreso', amount, reason, method, { id: a.id, name: a.name });
}

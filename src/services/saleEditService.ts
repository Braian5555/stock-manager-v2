/**
 * Editar y anular ventas ya cerradas, como "Ventas → Actualizar / Eliminar" de Fudo, con permisos:
 *
 * - "Editar ventas cerradas" (sales.edit): cambiar el medio de pago de un cobro, cambiar datos
 *   (comensales, mozo, cliente) y reabrir la venta para corregir lo pedido.
 * - "Anular ventas cerradas" (sales.void): anular la venta.
 *
 * Reglas (para no romper la caja ni lo fiscal):
 * - Siempre con motivo; queda anotado quién, cuándo y qué cambió (ticket.edits).
 * - Si la venta tiene factura de ARCA (autorizada o sin confirmar) no se reabre ni se anula:
 *   se corrige con nota de crédito. El medio de pago sí se puede cambiar.
 * - Sólo mientras la caja de cada cobro siga abierta (el arqueo cerrado no se toca).
 * - Reabrir o anular devuelve al stock lo que se descontó por receta (ajustes inversos).
 */
import { db } from '../database/db';
import type { Payment, Permission, SaleEdit, TableTicket, TicketCharge } from '../models';
import { nowIso } from '../utils/id';
import { paymentProblems, PAYMENT_LABEL } from './fiscalService';
import { revertMovement } from './stockService';
import { getCurrentActor, effectivePermissions } from './userService';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const actor = () => {
  const a = getCurrentActor();
  return a ? { id: a.id, name: a.name } : undefined;
};

/** La persona que está usando la app tiene ese permiso (sin sesión —pruebas, primer uso— no se frena). */
async function mustCan(perm: Permission, what: string) {
  const a = getCurrentActor();
  if (!a) return;
  const u = await db.users.get(a.id);
  if (!u) return;
  const perms = effectivePermissions(u);
  if (!perms.includes(perm) && !perms.includes('admin')) throw new Error(`No tenés permiso para ${what}.`);
}

const fmt = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const paysText = (ps: Payment[]) => ps.map((p) => `${PAYMENT_LABEL[p.method]} ${fmt(p.amount)}${p.accountName ? ` (${p.accountName})` : ''}`).join(' + ');

function mustReason(reason: string) {
  const r = reason.trim();
  if (r.length < 3) throw new Error('Escribí el motivo del cambio.');
  return r;
}

/** Facturas de la venta que impiden reabrirla o anularla (autorizadas o sin confirmar). */
export async function blockingDocs(t: TableTicket): Promise<number> {
  const ids = [t.fiscalDocId, ...(t.charges ?? []).map((c) => c.fiscalDocId)].filter((x): x is string => !!x);
  if (!ids.length) return 0;
  const docs = await db.fiscalDocs.bulkGet([...new Set(ids)]);
  return docs.filter((d) => d && d.status !== 'rechazada' && d.status !== 'error').length;
}

/** Cobros cuya caja ya se cerró (si hay alguno, no se puede tocar la venta). */
export async function closedCashCharges(t: TableTicket): Promise<TicketCharge[]> {
  const out: TicketCharge[] = [];
  for (const c of t.charges ?? []) {
    if (!c.cashSessionId) continue;
    const s = await db.cashSessions.get(c.cashSessionId);
    if (s && s.status === 'cerrada') out.push(c);
  }
  return out;
}

async function save(t: TableTicket, edit: Omit<SaleEdit, 'at' | 'by'>, patch: (t: TableTicket) => void): Promise<TableTicket> {
  const next: TableTicket = { ...t, lines: t.lines.map((l) => ({ ...l })), charges: t.charges?.map((c) => ({ ...c, payments: c.payments.map((p) => ({ ...p })) })) };
  patch(next);
  next.edits = [...(t.edits ?? []), { ...edit, at: nowIso(), by: actor() }];
  next.updatedAt = nowIso();
  await db.tickets.put(next);
  return next;
}

async function closedSale(ticketId: string): Promise<TableTicket> {
  const t = await db.tickets.get(ticketId);
  if (!t) throw new Error('La venta ya no existe.');
  if (t.status !== 'cerrada') throw new Error(t.status === 'anulada' ? 'Esa venta ya está anulada.' : 'Esa venta todavía está abierta: cambiala desde el pedido.');
  return t;
}

/** Cambia cómo se pagó un cobro (p. ej. era débito y se anotó efectivo). El total del cobro no cambia. */
export async function editChargePayments(ticketId: string, chargeId: string, payments: Payment[], reason: string): Promise<TableTicket> {
  await mustCan('sales.edit', 'editar ventas cerradas');
  const why = mustReason(reason);
  const t = await closedSale(ticketId);
  const c = (t.charges ?? []).find((x) => x.id === chargeId);
  if (!c) throw new Error('Ese cobro ya no existe.');
  if ((await closedCashCharges({ ...t, charges: [c] })).length) throw new Error('La caja de ese cobro ya se cerró: el arqueo no se puede cambiar.');
  const clean = payments.filter((p) => p.amount > 0).map((p) => ({ ...p, amount: round2(p.amount) }));
  const problems = paymentProblems(clean);
  if (problems.length) throw new Error(problems[0]);
  const sum = round2(clean.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(sum - c.amount) > 0.009) throw new Error(`Los pagos tienen que sumar ${fmt(c.amount)} (ahora suman ${fmt(sum)}).`);
  return save(t, { action: 'pagos', reason: why, detail: `${paysText(c.payments)} → ${paysText(clean)}` }, (n) => {
    const nc = n.charges!.find((x) => x.id === chargeId)!;
    nc.payments = clean;
    n.payments = n.charges!.flatMap((x) => x.payments);
  });
}

/** Cambia los datos de la venta: comensales, mozo y cliente. */
export async function editSaleInfo(ticketId: string, info: { guests?: number; waiter?: { id: string; name: string }; customer?: TableTicket['customer'] }, reason: string): Promise<TableTicket> {
  await mustCan('sales.edit', 'editar ventas cerradas');
  const why = mustReason(reason);
  const t = await closedSale(ticketId);
  const changes: string[] = [];
  if (info.guests !== undefined && info.guests !== t.guests) changes.push(`comensales ${t.guests ?? '—'} → ${info.guests || '—'}`);
  if (info.waiter && info.waiter.id !== t.openedBy?.id) changes.push(`mozo ${t.openedBy?.name ?? '—'} → ${info.waiter.name}`);
  const cust = (c?: TableTicket['customer']) => [c?.name, c?.phone, c?.address].filter(Boolean).join(' · ');
  if (info.customer && cust(info.customer) !== cust(t.customer)) changes.push(`cliente ${cust(t.customer) || '—'} → ${cust(info.customer) || '—'}`);
  if (!changes.length) throw new Error('No cambiaste nada.');
  return save(t, { action: 'datos', reason: why, detail: changes.join(' · ') }, (n) => {
    if (info.guests !== undefined) n.guests = info.guests || undefined;
    if (info.waiter) n.openedBy = info.waiter;
    if (info.customer) n.customer = info.customer;
  });
}

/** Devuelve al stock lo que se descontó por receta al cerrar la venta. */
async function returnStock(t: TableTicket): Promise<number> {
  const moves = await db.movements.where('refId').equals(t.id).filter((m) => m.type === 'venta').toArray();
  let n = 0;
  for (const m of moves) {
    if (await db.movements.where('idempotencyKey').equals(`undo:${m.id}`).first()) continue;
    const r = await revertMovement(m);
    if (!r.duplicate) n++;
  }
  return n;
}

async function mustBeTouchable(t: TableTicket, verb: string) {
  if (await blockingDocs(t)) throw new Error(`Esta venta tiene factura de ARCA: no se puede ${verb}. Hacé una nota de crédito desde Comprobantes.`);
  if ((await closedCashCharges(t)).length) throw new Error(`La caja de esta venta ya se cerró: no se puede ${verb}.`);
}

/**
 * Reabre la venta para corregir lo pedido: vuelve a estar abierta (sin cobros), el stock vuelve y
 * después se cobra de nuevo. Los cobros que tenía quedan anotados en el historial de cambios.
 */
export async function reopenSale(ticketId: string, reason: string): Promise<TableTicket> {
  await mustCan('sales.edit', 'reabrir ventas');
  const why = mustReason(reason);
  const t = await closedSale(ticketId);
  await mustBeTouchable(t, 'reabrir');
  if ((t.channel ?? 'mesa') === 'mesa') {
    const busy = await db.tickets.where('tableId').equals(t.tableId).filter((x) => x.id !== t.id && (x.status === 'abierta' || x.status === 'cuenta')).count();
    if (busy) throw new Error(`La mesa ${t.tableName} está ocupada: cerrá ese pedido antes de reabrir este.`);
  }
  const had = (t.charges ?? []).map((c) => `${c.label ?? 'Cobro'}: ${paysText(c.payments)}${c.tip ? ` + propina ${fmt(c.tip.amount)}` : ''}`).join(' · ');
  await returnStock(t);
  return save(t, { action: 'reabierta', reason: why, detail: had ? `Se sacaron los cobros (${had})` : undefined }, (n) => {
    n.status = 'abierta';
    n.closedAt = undefined;
    n.paidAt = undefined;
    n.payments = undefined;
    n.charges = undefined;
    n.fiscalPending = undefined;
  });
}

/** Anula una venta cerrada: deja de contar en ventas y caja, y el stock vuelve. */
export async function voidSale(ticketId: string, reason: string): Promise<TableTicket> {
  await mustCan('sales.void', 'anular ventas cerradas');
  const why = mustReason(reason);
  const t = await closedSale(ticketId);
  await mustBeTouchable(t, 'anular');
  await returnStock(t);
  return save(t, { action: 'anulada', reason: why, detail: `Total ${fmt(t.total)}` }, (n) => {
    n.status = 'anulada';
    n.fiscalPending = undefined;
  });
}

/**
 * Salón (estilo Fudo): plano de mesas, mostrador / para llevar / delivery, carta con adicionales,
 * comandas a cocina, descuentos y cortesías.
 *
 * El cobro (con factura ARCA, división de cuenta y caja) está en fiscalService y cashService.
 * Si la facturación de Stock Manager está apagada, al cerrar el pedido queda "pendiente para
 * Maxirest". No se descuenta stock al vender (el stock sale de producción y de la cámara).
 */
import { db } from '../database/db';
import type { DiningTable, IvaRate, MenuExtra, MenuItem, TableShape, TableTicket, TicketChannel, TicketDiscount, TicketLine } from '../models';
import { nowIso, uuid } from '../utils/id';
import { saveEntity, type Draft } from './entityService';
import { getCurrentActor } from './userService';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Suma de lo que se cobra (sin anulados ni cortesías). */
export const ticketTotal = (lines: TicketLine[]) => round2(lines.filter((l) => l.qty > 0 && !l.comp).reduce((s, l) => s + l.price * l.qty, 0));
export const discountAmount = (subtotal: number, d?: TicketDiscount) => (!d ? 0 : d.kind === 'pct' ? round2(subtotal * Math.min(100, Math.max(0, d.value)) / 100) : round2(Math.min(subtotal, Math.max(0, d.value))));
export const isOpen = (t: Pick<TableTicket, 'status'>) => t.status === 'abierta' || t.status === 'cuenta';
/** Lo que ya se cobró de la cuenta (si se dividió). */
export const chargedAmount = (t: Pick<TableTicket, 'charges'>) => round2((t.charges ?? []).reduce((s, c) => s + c.amount, 0));
export const remainingAmount = (t: Pick<TableTicket, 'charges' | 'total'>) => round2(Math.max(0, t.total - chargedAmount(t)));
/** Cuántas unidades de un ítem ya se pagaron (cuenta dividida por ítems). */
export const paidQty = (t: Pick<TableTicket, 'charges'>, lineId: string) => (t.charges ?? []).reduce((s, c) => s + (c.items ?? []).filter((i) => i.lineId === lineId).reduce((x, i) => x + i.qty, 0), 0);

export const CHANNEL_LABEL: Record<TicketChannel, string> = { mesa: 'Mesa', mostrador: 'Mostrador', llevar: 'Para llevar', delivery: 'Delivery' };
export const channelOf = (t: Pick<TableTicket, 'channel'>): TicketChannel => t.channel ?? 'mesa';
/** "Mesa 4", "Mostrador · Ana", "Delivery #12". */
export function ticketLabel(t: Pick<TableTicket, 'channel' | 'tableName' | 'customer' | 'number'>): string {
  const ch = channelOf(t);
  if (ch === 'mesa') return `Mesa ${t.tableName}`;
  return `${CHANNEL_LABEL[ch]} · ${t.customer?.name?.trim() || `#${t.number}`}`;
}

// ───────────── Mesas ─────────────

export async function saveTable(d: { id?: string; name: string; zone: string; seats?: number; active?: boolean; order?: number; shape?: TableShape; size?: 1 | 2 | 3 }): Promise<DiningTable> {
  const name = d.name.trim();
  if (!name) throw new Error('Poné el nombre o número de la mesa.');
  const zone = d.zone.trim() || 'Salón';
  const all = await db.diningTables.toArray();
  if (all.some((t) => t.id !== d.id && t.active && t.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es')))
    throw new Error(`Ya hay una mesa "${name}".`);
  const prev = d.id ? all.find((t) => t.id === d.id) : undefined;
  return saveEntity(db.diningTables, {
    id: d.id,
    name,
    zone,
    ...(d.seats ? { seats: d.seats } : {}),
    order: d.order ?? prev?.order ?? (all.length ? Math.max(...all.map((t) => t.order)) + 1 : 1),
    active: d.active ?? prev?.active ?? true,
    ...(prev?.x !== undefined && prev.zone === zone ? { x: prev.x, y: prev.y } : {}),
    shape: d.shape ?? prev?.shape,
    size: d.size ?? prev?.size,
  } as Draft<DiningTable>);
}

/** Ubica la mesa en el plano (en % del sector) y/o le cambia forma y tamaño. */
export async function placeTable(id: string, p: { x?: number; y?: number; shape?: TableShape; size?: 1 | 2 | 3 }): Promise<DiningTable> {
  const t = await db.diningTables.get(id);
  if (!t) throw new Error('La mesa no existe.');
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
  return saveEntity(db.diningTables, {
    ...t,
    ...(p.x !== undefined ? { x: clamp(p.x) } : {}),
    ...(p.y !== undefined ? { y: clamp(p.y) } : {}),
    ...(p.shape ? { shape: p.shape } : {}),
    ...(p.size ? { size: p.size } : {}),
  });
}

/** Crea varias mesas numeradas de una vez ("1" a "12" en "Salón"). Saltea las que ya existen. */
export async function addNumberedTables(from: number, to: number, zone: string): Promise<number> {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw new Error('Revisá los números de mesa.');
  if (to - from > 99) throw new Error('Son demasiadas mesas de una vez (hasta 100).');
  const names = new Set((await db.diningTables.toArray()).filter((t) => t.active).map((t) => t.name.toLocaleLowerCase('es')));
  let added = 0;
  for (let n = from; n <= to; n++) {
    if (names.has(String(n))) continue;
    await saveTable({ name: String(n), zone });
    added++;
  }
  return added;
}

/** Las mesas no se borran (quedan en el historial de pedidos): se dan de baja. */
export async function retireTable(id: string): Promise<void> {
  const open = await db.tickets.where('tableId').equals(id).filter(isOpen).count();
  if (open) throw new Error('La mesa tiene un pedido abierto: cerralo o anulalo primero.');
  await saveEntity(db.diningTables, { ...(await db.diningTables.get(id))!, active: false });
}

// ───────────── Carta ─────────────

export async function saveMenuItem(d: { id?: string; name: string; section: string; price: number; maxirestCode?: string; kitchen: boolean; active?: boolean; iva?: IvaRate; extras?: MenuExtra[] }): Promise<MenuItem> {
  const name = d.name.trim();
  if (!name) throw new Error('Poné el nombre del plato o la bebida.');
  if (!Number.isFinite(d.price) || d.price < 0) throw new Error('El precio no es válido.');
  const all = await db.menuItems.toArray();
  if (all.some((m) => m.id !== d.id && m.active && m.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es')))
    throw new Error(`"${name}" ya está en la carta.`);
  const code = d.maxirestCode?.trim();
  const extras = (d.extras ?? []).map((e) => ({ name: e.name.trim(), price: round2(Number(e.price) || 0) })).filter((e) => e.name);
  if (extras.some((e) => e.price < 0)) throw new Error('El precio de un adicional no puede ser negativo.');
  if (new Set(extras.map((e) => e.name.toLocaleLowerCase('es'))).size !== extras.length) throw new Error('Hay dos adicionales con el mismo nombre.');
  return saveEntity(db.menuItems, {
    id: d.id,
    name,
    section: d.section.trim() || 'General',
    price: round2(d.price),
    ...(code ? { maxirestCode: code } : { maxirestCode: undefined }),
    kitchen: d.kitchen,
    iva: d.iva,
    extras: extras.length ? extras : undefined,
    active: d.active ?? true,
  } as Draft<MenuItem>);
}

// ───────────── Pedidos ─────────────

const actor = () => {
  const a = getCurrentActor();
  return a ? { id: a.id, name: a.name } : undefined;
};

async function mutate(ticketId: string, fn: (t: TableTicket) => void): Promise<TableTicket> {
  return db.transaction('rw', db.tickets, async () => {
    const t = await db.tickets.get(ticketId);
    if (!t) throw new Error('El pedido ya no existe.');
    const next: TableTicket = { ...t, lines: t.lines.map((l) => ({ ...l })) };
    fn(next);
    next.subtotal = ticketTotal(next.lines);
    next.total = round2(next.subtotal - discountAmount(next.subtotal, next.discount));
    next.updatedAt = nowIso();
    await db.tickets.put(next);
    return next;
  });
}

const mustBeOpen = (t: TableTicket) => {
  if (!isOpen(t)) throw new Error('Ese pedido ya está cerrado.');
};

async function nextNumber() {
  // Número correlativo del día (mesas y mostrador comparten la numeración).
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = await db.tickets.where('openedAt').aboveOrEqual(start.toISOString()).toArray();
  return today.reduce((m, x) => Math.max(m, x.number), 0) + 1;
}

export async function openTicket(tableId: string, guests?: number): Promise<TableTicket> {
  const table = await db.diningTables.get(tableId);
  if (!table || !table.active) throw new Error('La mesa no existe.');
  return db.transaction('rw', db.tickets, async () => {
    const open = await db.tickets.where('tableId').equals(tableId).filter(isOpen).first();
    if (open) return open;
    const number = await nextNumber();
    const t = nowIso();
    const by = actor();
    const ticket: TableTicket = {
      id: uuid(),
      createdAt: t,
      updatedAt: t,
      tableId,
      tableName: table.name,
      number,
      channel: 'mesa',
      openedAt: t,
      ...(by ? { openedBy: by } : {}),
      ...(guests ? { guests } : {}),
      status: 'abierta',
      lines: [],
      total: 0,
    };
    await db.tickets.add(ticket);
    return ticket;
  });
}

/** Pedido de mostrador, para llevar o delivery (sin mesa). Con envío, suma el ítem "Envío". */
export async function openCounterTicket(channel: Exclude<TicketChannel, 'mesa'>, customer: { name?: string; phone?: string; address?: string } = {}, shipping?: number): Promise<TableTicket> {
  const c = { name: customer.name?.trim() || undefined, phone: customer.phone?.trim() || undefined, address: customer.address?.trim() || undefined };
  if (channel === 'delivery' && !c.address) throw new Error('Para delivery poné la dirección.');
  if (shipping !== undefined && (!Number.isFinite(shipping) || shipping < 0)) throw new Error('El envío no es válido.');
  const t = nowIso();
  const by = actor();
  const ticket: TableTicket = {
    id: uuid(), createdAt: t, updatedAt: t,
    tableId: '', tableName: CHANNEL_LABEL[channel], number: await nextNumber(), channel,
    ...(c.name || c.phone || c.address ? { customer: c } : {}),
    openedAt: t, ...(by ? { openedBy: by } : {}), status: 'abierta', lines: [], total: 0, subtotal: 0,
  };
  await db.tickets.add(ticket);
  if (shipping) return addCustomLine(ticket.id, 'Envío', shipping);
  return ticket;
}

export async function updateCustomer(ticketId: string, customer: { name?: string; phone?: string; address?: string }): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    t.customer = { name: customer.name?.trim() || undefined, phone: customer.phone?.trim() || undefined, address: customer.address?.trim() || undefined };
  });
}

const extrasKey = (e?: MenuExtra[]) => (e ?? []).map((x) => x.name).sort().join('|');

/**
 * Suma un plato al pedido (con adicionales si se eligieron: su precio se suma al del plato).
 * Si ya hay uno igual sin mandar (mismos adicionales, sin nota), suma cantidad.
 */
export async function addLine(ticketId: string, item: MenuItem, qty = 1, notes?: string, extras?: MenuExtra[]): Promise<TableTicket> {
  const note = notes?.trim() || undefined;
  const chosen = (extras ?? []).filter((e) => e.name);
  const price = round2(item.price + chosen.reduce((s, e) => s + e.price, 0));
  const name = chosen.length ? `${item.name} + ${chosen.map((e) => e.name).join(', ')}` : item.name;
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    const same = t.lines.find((l) => l.status === 'nuevo' && l.menuItemId === item.id && !l.notes && !note && !l.comp && extrasKey(l.extras) === extrasKey(chosen));
    if (same) same.qty += qty;
    else {
      const by = actor();
      t.lines.push({ id: uuid(), menuItemId: item.id, name, price, qty, kitchen: item.kitchen, status: 'nuevo', ...(chosen.length ? { extras: chosen } : {}), ...(note ? { notes: note } : {}), ...(by ? { by } : {}) });
    }
    if (t.status === 'cuenta') t.status = 'abierta';
  });
}

/** Ítem libre (envío, varios): no es de la carta y no va a cocina salvo que se indique. */
export async function addCustomLine(ticketId: string, name: string, price: number, kitchen = false): Promise<TableTicket> {
  const n = name.trim();
  if (!n) throw new Error('Poné qué es.');
  if (!Number.isFinite(price) || price < 0) throw new Error('El precio no es válido.');
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    const by = actor();
    t.lines.push({ id: uuid(), menuItemId: 'custom', name: n, price: round2(price), qty: 1, kitchen, status: kitchen ? 'nuevo' : 'entregado', custom: true, ...(kitchen ? {} : { sentAt: nowIso() }), ...(by ? { by } : {}) });
  });
}

/** Cortesía (invita la casa): el ítem queda en el pedido pero no se cobra. */
export async function setComp(ticketId: string, lineId: string, comp: boolean): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    const l = t.lines.find((x) => x.id === lineId);
    if (!l) return;
    if (paidQty(t, lineId) > 0) throw new Error('Ese ítem ya se cobró en una parte de la cuenta.');
    l.comp = comp || undefined;
  });
}

/** Descuento sobre toda la cuenta (% o monto). null lo saca. */
export async function setDiscount(ticketId: string, d: TicketDiscount | null): Promise<TableTicket> {
  if (d) {
    if (!Number.isFinite(d.value) || d.value <= 0) throw new Error('Poné un descuento mayor a cero.');
    if (d.kind === 'pct' && d.value > 100) throw new Error('El descuento no puede pasar el 100%.');
  }
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    if (t.charges?.length) throw new Error('Ya se cobró una parte de la cuenta: el descuento se aplica antes de dividir.');
    if (d) t.discount = { kind: d.kind, value: round2(d.value), ...(d.reason?.trim() ? { reason: d.reason.trim() } : {}) };
    else delete t.discount;
  });
}

/** Cambia cantidad o nota de un plato que todavía no se mandó. Con cantidad 0 lo saca. */
export async function updateLine(ticketId: string, lineId: string, patch: { qty?: number; notes?: string }): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    const l = t.lines.find((x) => x.id === lineId);
    if (!l) return;
    if (l.status !== 'nuevo') throw new Error('Ese plato ya se mandó a cocina: para sacarlo, anulalo.');
    if (patch.notes !== undefined) l.notes = patch.notes.trim() || undefined;
    if (patch.qty !== undefined) {
      if (patch.qty <= 0) t.lines = t.lines.filter((x) => x.id !== lineId);
      else l.qty = patch.qty;
    }
  });
}

/** Anula un plato ya mandado (p. ej. se equivocaron): queda en 0 para que cocina lo vea tachado. */
export async function voidLine(ticketId: string, lineId: string): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    const l = t.lines.find((x) => x.id === lineId);
    if (!l) return;
    if (paidQty(t, lineId) > 0) throw new Error('Ese ítem ya se cobró en una parte de la cuenta.');
    if (l.status === 'nuevo') t.lines = t.lines.filter((x) => x.id !== lineId);
    else l.qty = 0;
  });
}

/** Manda la comanda: lo de cocina va a la pantalla de Cocina; lo demás (bebidas) sale directo. */
export async function sendToKitchen(ticketId: string): Promise<{ ticket: TableTicket; sent: number }> {
  let sent = 0;
  const ticket = await mutate(ticketId, (t) => {
    mustBeOpen(t);
    const at = nowIso();
    for (const l of t.lines) {
      if (l.status !== 'nuevo') continue;
      sent += l.qty;
      l.sentAt = at;
      l.status = l.kitchen ? 'cocina' : 'entregado';
    }
  });
  return { ticket, sent };
}

export async function markLineReady(ticketId: string, lineId: string): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    const l = t.lines.find((x) => x.id === lineId);
    if (l && l.status === 'cocina') { l.status = 'listo'; l.readyAt = nowIso(); }
  });
}

/** Cocina: todo lo de esa mesa listo. */
export async function markTicketReady(ticketId: string): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    const at = nowIso();
    for (const l of t.lines) if (l.status === 'cocina') { l.status = 'listo'; l.readyAt = at; }
  });
}

/** El mozo lo llevó a la mesa. */
export async function markDelivered(ticketId: string, lineId?: string): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    for (const l of t.lines) if (l.status === 'listo' && (!lineId || l.id === lineId)) l.status = 'entregado';
  });
}

export async function requestBill(ticketId: string): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    if (!t.lines.some((l) => l.qty > 0)) throw new Error('El pedido está vacío.');
    if (channelOf(t) !== 'mesa') return;
    t.status = 'cuenta';
  });
}

/**
 * Cierra la mesa: queda libre. Si se cobra en Maxirest, el pedido pasa a la cola para Maxirest;
 * si se facturó en Stock Manager (`maxirest: false`), no (si no, se facturaría dos veces).
 */
export async function closeTicket(ticketId: string, opts: { maxirest?: boolean } = {}): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    if (t.lines.some((l) => l.status === 'nuevo')) throw new Error('Hay platos sin mandar: mandalos o sacalos antes de cerrar.');
    if (!t.lines.some((l) => l.qty > 0)) throw new Error('El pedido está vacío: si no se pidió nada, anulalo.');
    t.status = 'cerrada';
    t.closedAt = nowIso();
    if (opts.maxirest !== false) t.maxirest = { status: 'pendiente' };
    else delete t.maxirest;
  });
}

export async function cancelTicket(ticketId: string): Promise<TableTicket> {
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    if (t.charges?.length) throw new Error('Ya se cobró una parte de la cuenta: no se puede anular (hacé una nota de crédito si hace falta).');
    t.status = 'anulada';
    t.closedAt = nowIso();
  });
}

/** Pasa el pedido a otra mesa libre. */
export async function moveTicket(ticketId: string, tableId: string): Promise<TableTicket> {
  const table = await db.diningTables.get(tableId);
  if (!table || !table.active) throw new Error('La mesa no existe.');
  const busy = await db.tickets.where('tableId').equals(tableId).filter(isOpen).count();
  if (busy) throw new Error(`La mesa ${table.name} está ocupada.`);
  return mutate(ticketId, (t) => {
    mustBeOpen(t);
    if (channelOf(t) !== 'mesa') throw new Error('Sólo los pedidos de mesa se cambian de mesa.');
    t.tableId = table.id;
    t.tableName = table.name;
  });
}

// ───────────── Maxirest (la API va aparte) ─────────────

/**
 * Lo que se le mandaría a Maxirest por cada pedido cerrado. El envío lo hace un servicio aparte
 * cuando Maxirest habilite la API; los artículos sin código quedan marcados para revisarlos.
 */
export function maxirestPayload(t: TableTicket, items: Map<string, MenuItem>) {
  const lines = t.lines.filter((l) => l.qty > 0 && !l.comp);
  return {
    externalId: t.id,
    canal: channelOf(t),
    mesa: channelOf(t) === 'mesa' ? t.tableName : undefined,
    cliente: t.customer,
    descuento: t.discount ? discountAmount(t.subtotal ?? t.total, t.discount) : 0,
    numero: t.number,
    abierto: t.openedAt,
    cerrado: t.closedAt,
    comensales: t.guests,
    mozo: t.openedBy?.name,
    total: t.total,
    items: lines.map((l) => ({ codigo: items.get(l.menuItemId)?.maxirestCode ?? null, nombre: l.name, cantidad: l.qty, precio: l.price, nota: l.notes })),
    sinCodigo: lines.filter((l) => !items.get(l.menuItemId)?.maxirestCode).map((l) => l.name),
  };
}

export async function markMaxirest(ticketId: string, status: 'pendiente' | 'enviado' | 'error', error?: string): Promise<void> {
  const t = await db.tickets.get(ticketId);
  if (!t) return;
  await db.tickets.put({ ...t, maxirest: { status, at: nowIso(), ...(error ? { error } : {}) }, updatedAt: nowIso() });
}

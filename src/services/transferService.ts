/**
 * Remitos internos: mercadería que sale del Depósito Central hacia un punto gastronómico.
 *
 * Cada remito genera, por producto, dos movimientos inmutables con clave de idempotencia:
 *   - salida en el Depósito Central (resta Product.stock)
 *   - ingreso en el punto (suma al stock del punto)
 * Anular un remito NO borra esos movimientos: registra los inversos.
 *
 * Maxirest: no hay una interfaz oficial para escribir stock. Cada remito queda "pendiente
 * en Maxirest" hasta que alguien lo carga allá (a mano o con el Excel) y lo marca como cargado.
 */
import { db } from '../database/db';
import type { Outlet, Transfer, TransferItem } from '../models';
import { nowIso, uuid } from '../utils/id';
import { round3 } from '../utils/format';
import { applyMovement } from './stockService';
import { getCurrentActor } from './userService';

export const transferCode = (n: number) => `R-${String(n).padStart(4, '0')}`;

export const MAXIREST_LABEL: Record<Transfer['maxirest'], string> = {
  pendiente: 'Pendiente en Maxirest',
  cargado: 'Cargado en Maxirest',
  no_aplica: 'No va a Maxirest',
};

// ───────────── Puntos ─────────────

export async function saveOutlet(d: { id?: string; name: string; maxirestName?: string; active: boolean }): Promise<Outlet> {
  const name = d.name.trim();
  if (!name) throw new Error('Ingresá el nombre del punto.');
  const all = await db.outlets.toArray();
  if (all.some((o) => o.id !== d.id && o.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) throw new Error('Ya existe un punto con ese nombre.');
  const prev = d.id ? await db.outlets.get(d.id) : undefined;
  const t = nowIso();
  const o: Outlet = { id: prev?.id ?? uuid(), createdAt: prev?.createdAt ?? t, updatedAt: t, name, maxirestName: d.maxirestName?.trim() || undefined, active: d.active };
  await db.outlets.put(o);
  return o;
}

/** Sólo se puede borrar un punto sin remitos ni movimientos; si no, se desactiva. */
export async function deleteOutlet(id: string): Promise<void> {
  const used = (await db.transfers.where('outletId').equals(id).count()) > 0 || (await db.movements.filter((m) => m.outletId === id).count()) > 0;
  if (used) throw new Error('El punto tiene remitos o movimientos: desactivalo en lugar de eliminarlo.');
  await db.outlets.delete(id);
}

// ───────────── Remitos ─────────────

export interface TransferDraft {
  date: string;
  outletId: string;
  items: TransferItem[];
  notes?: string;
}

export interface TransferResult {
  transfer: Transfer;
  /** Productos que quedaron con stock negativo en el depósito (para avisar). */
  negative: string[];
}

/** Junta líneas repetidas del mismo producto y descarta cantidades vacías. */
export function normalizeItems(items: TransferItem[]): TransferItem[] {
  const m = new Map<string, number>();
  for (const i of items) {
    if (!i.productId || !(i.quantity > 0)) continue;
    m.set(i.productId, round3((m.get(i.productId) ?? 0) + i.quantity));
  }
  return [...m].map(([productId, quantity]) => ({ productId, quantity }));
}

export async function createTransfer(d: TransferDraft): Promise<TransferResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new Error('Ingresá la fecha del remito.');
  const outlet = await db.outlets.get(d.outletId);
  if (!outlet) throw new Error('Elegí a qué punto va la mercadería.');
  if (!outlet.active) throw new Error('Ese punto está desactivado.');
  const items = normalizeItems(d.items);
  if (!items.length) throw new Error('Agregá al menos un producto con cantidad.');

  return db.transaction('rw', [db.transfers, db.products, db.movements], async () => {
    for (const i of items) if (!(await db.products.get(i.productId))) throw new Error('Uno de los productos ya no existe.');
    const last = await db.transfers.orderBy('number').last();
    const t = nowIso();
    const transfer: Transfer = {
      id: uuid(),
      createdAt: t,
      updatedAt: t,
      number: (last?.number ?? 0) + 1,
      date: d.date,
      outletId: outlet.id,
      items,
      notes: d.notes?.trim() || undefined,
      status: 'enviado',
      createdBy: getCurrentActor(),
      maxirest: 'pendiente',
    };
    await db.transfers.add(transfer);
    const reason = `Remito ${transferCode(transfer.number)} → ${outlet.name}`;
    const negative: string[] = [];
    for (const i of items) {
      const { movement } = await applyMovement({
        productId: i.productId, type: 'salida', delta: -i.quantity, reason, origin: 'remito', refId: transfer.id,
        idempotencyKey: `transfer:${transfer.id}:${i.productId}:out`,
      });
      if (movement.quantityAfter < 0) negative.push(i.productId);
      await applyMovement({
        productId: i.productId, type: 'ingreso', delta: i.quantity, reason: `Remito ${transferCode(transfer.number)} desde Depósito Central`, origin: 'remito', refId: transfer.id,
        idempotencyKey: `transfer:${transfer.id}:${i.productId}:in`, outletId: outlet.id,
      });
    }
    return { transfer, negative };
  });
}

/** Anula un remito: devuelve la mercadería al depósito con movimientos inversos. */
export async function voidTransfer(id: string): Promise<Transfer> {
  return db.transaction('rw', [db.transfers, db.products, db.movements, db.outlets], async () => {
    const tr = await db.transfers.get(id);
    if (!tr) throw new Error('El remito no existe.');
    if (tr.status === 'anulado') return tr;
    const outlet = await db.outlets.get(tr.outletId);
    const reason = `Anulación remito ${transferCode(tr.number)}`;
    for (const i of tr.items) {
      if (!(await db.products.get(i.productId))) continue;
      await applyMovement({ productId: i.productId, type: 'ingreso', delta: i.quantity, reason, origin: 'remito', refId: tr.id, idempotencyKey: `transfer:${tr.id}:${i.productId}:void-out` });
      await applyMovement({ productId: i.productId, type: 'salida', delta: -i.quantity, reason: `${reason}${outlet ? ` (${outlet.name})` : ''}`, origin: 'remito', refId: tr.id, idempotencyKey: `transfer:${tr.id}:${i.productId}:void-in`, outletId: tr.outletId });
    }
    const t = nowIso();
    // Si ya estaba cargado en Maxirest, la anulación también hay que cargarla allá.
    const patch: Partial<Transfer> = { status: 'anulado', voidedAt: t, voidedBy: getCurrentActor(), updatedAt: t, maxirest: tr.maxirest === 'cargado' ? 'pendiente' : 'no_aplica' };
    if (tr.maxirest === 'cargado') Object.assign(patch, { maxirestAt: undefined, maxirestBy: undefined });
    await db.transfers.update(id, patch);
    return { ...tr, ...patch };
  });
}

/** Marca remitos como cargados (o pendientes otra vez) en Maxirest. */
export async function setMaxirestLoaded(ids: string[], loaded: boolean): Promise<number> {
  const t = nowIso();
  const actor = getCurrentActor();
  let n = 0;
  await db.transaction('rw', db.transfers, async () => {
    for (const id of ids) {
      const tr = await db.transfers.get(id);
      if (!tr || tr.maxirest === 'no_aplica') continue;
      await db.transfers.update(id, loaded ? { maxirest: 'cargado', maxirestAt: t, maxirestBy: actor, updatedAt: t } : { maxirest: 'pendiente', maxirestAt: undefined, maxirestBy: undefined, updatedAt: t });
      n++;
    }
  });
  return n;
}

// ───────────── Excel para Maxirest ─────────────

export const MAXIREST_EXPORT_COLUMNS = ['Fecha', 'Remito', 'Tipo', 'Depósito origen', 'Depósito destino', 'Código Maxirest', 'Insumo', 'Cantidad', 'Unidad'];

/**
 * Filas para el Excel de carga en Maxirest (una por producto). Un remito anulado que ya
 * estaba cargado sale con tipo "Anulación" y la mercadería vuelve al depósito.
 * Formato GENÉRICO: se ajusta al formato exacto de importación de Maxirest cuando haya un ejemplo real.
 */
export async function maxirestRows(transfers: Transfer[], centralName = 'Depósito Central'): Promise<(string | number)[][]> {
  const [products, units, outlets] = await Promise.all([db.products.toArray(), db.units.toArray(), db.outlets.toArray()]);
  const p = new Map(products.map((x) => [x.id, x]));
  const u = new Map(units.map((x) => [x.id, x.abbreviation || x.name]));
  const o = new Map(outlets.map((x) => [x.id, x.maxirestName || x.name]));
  const rows: (string | number)[][] = [];
  for (const tr of [...transfers].sort((a, b) => a.number - b.number)) {
    const voided = tr.status === 'anulado';
    const dest = o.get(tr.outletId) ?? '';
    for (const i of tr.items) {
      const prod = p.get(i.productId);
      const code = prod?.externalSystems?.maxirest?.code ?? prod?.externalSystems?.maxirest?.id ?? prod?.sku ?? '';
      rows.push([
        `${tr.date.slice(8, 10)}/${tr.date.slice(5, 7)}/${tr.date.slice(0, 4)}`,
        transferCode(tr.number),
        voided ? 'Anulación' : 'Transferencia',
        voided ? dest : centralName,
        voided ? centralName : dest,
        code,
        prod?.name ?? '(producto eliminado)',
        i.quantity,
        u.get(prod?.unitId ?? '') ?? '',
      ]);
    }
  }
  return rows;
}

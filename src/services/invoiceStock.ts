/**
 * Facturas → stock (etapa 2): cargar al stock los renglones revisados, deshacerlo, recordar las
 * equivalencias que se confirmaron y crear productos nuevos desde un renglón de la factura.
 *
 * - Cada renglón se carga como un ingreso con clave fija (factura + renglón): aunque se toque dos
 *   veces o se cargue desde dos celulares, entra una sola vez.
 * - Deshacer revierte esos ingresos con ajustes inversos (no se borra historia).
 */
import { db } from '../database/db';
import type { Invoice, InvoiceItem, Product, Unit } from '../models';
import { normalize, round3 } from '../utils/format';
import { nowIso } from '../utils/id';
import { aliasKey, isPackUnit, needsPackSize, toStockQty, type CatalogLookups } from './invoiceAI';
import { emptyProduct, saveProduct } from './productService';
import { applyMovement, revertMovement } from './stockService';
import { getCurrentActor } from './userService';

const MAX_ALIASES = 30;

/** Renglones que todavía necesitan una decisión (producto a confirmar o elegir). */
export const pendingItems = (items: InvoiceItem[] = []) => items.filter((i) => i.status === 'check' || i.status === 'none');
/** Renglones que van al stock. */
export const loadableItems = (items: InvoiceItem[] = []) => items.filter((i) => i.status === 'ok' && i.productId && (i.stockQty ?? 0) > 0);

/** Clave del ingreso de un renglón. Si una carga anterior se deshizo, se usa la siguiente (":2"…). */
async function itemKey(invoiceId: string, itemId: string): Promise<string> {
  const base = `factura:${invoiceId}:${itemId}`;
  for (let n = 1; n < 50; n++) {
    const key = n === 1 ? base : `${base}:${n}`;
    const m = await db.movements.where('idempotencyKey').equals(key).first();
    if (!m) return key;
    const undone = await db.movements.where('idempotencyKey').equals(`undo:${m.id}`).first();
    if (!undone) return key; // vigente: applyMovement lo detecta como duplicado
  }
  return `${base}:${Date.now()}`;
}

/** Carga al stock los renglones confirmados. Devuelve cuántos ingresos se registraron. */
export async function applyInvoiceToStock(invoiceId: string): Promise<{ applied: number; skipped: number }> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) throw new Error('La factura no existe.');
  if (inv.stockAppliedAt) throw new Error('Esta factura ya se cargó al stock.');
  const items = inv.items ?? [];
  const pending = pendingItems(items);
  if (pending.length) throw new Error(`Antes de cargar, revisá ${pending.length} ${pending.length === 1 ? 'renglón' : 'renglones'}: confirmá el producto o marcá "No va al stock".`);
  const toLoad = loadableItems(items);
  if (!toLoad.length) throw new Error('No hay renglones para cargar al stock.');
  const supplier = inv.supplierId ? (await db.suppliers.get(inv.supplierId))?.name : undefined;
  const reason = ['Factura', inv.number, supplier && `· ${supplier}`].filter(Boolean).join(' ');

  const units = await db.units.toArray();
  const lk: CatalogLookups = { unit: (id) => units.find((u) => u.id === id)?.abbreviation ?? '' };
  for (const item of toLoad) {
    const p = await db.products.get(item.productId!);
    if (!p) throw new Error(`El producto de “${item.description}” ya no existe. Elegí otro.`);
    if (needsPackSize(item, p, lk)) throw new Error(`Falta cuántas unidades trae cada ${item.unit ?? 'caja'} de “${item.description}”.`);
  }

  // Todo o nada: si un renglón falla, no queda la factura cargada a medias.
  const ids = await db.transaction('rw', db.products, db.movements, db.invoices, async () => {
    const fresh = await db.invoices.get(inv.id);
    if (fresh?.stockAppliedAt) throw new Error('Esta factura ya se cargó al stock.');
    const out: string[] = [];
    for (const item of toLoad) {
      const { movement } = await applyMovement({
        productId: item.productId!,
        type: 'ingreso',
        delta: round3(item.stockQty!),
        origin: 'factura',
        reason,
        refId: inv.id,
        idempotencyKey: await itemKey(inv.id, item.id),
      });
      out.push(movement.id);
    }
    await db.invoices.update(inv.id, { stockAppliedAt: nowIso(), stockAppliedBy: getCurrentActor(), stockMovementIds: out, updatedAt: nowIso() });
    return out;
  });
  return { applied: ids.length, skipped: items.length - ids.length };
}

/** Deshace la carga: el stock vuelve a como estaba (con ajustes inversos, sin borrar historia). */
export async function undoInvoiceStock(invoiceId: string): Promise<number> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv?.stockAppliedAt) throw new Error('Esta factura no está cargada al stock.');
  return db.transaction('rw', db.products, db.movements, db.invoices, async () => {
    let n = 0;
    for (const id of inv.stockMovementIds ?? []) {
      const m = await db.movements.get(id);
      if (!m) continue;
      const { duplicate } = await revertMovement(m);
      if (!duplicate) n++;
    }
    await db.invoices.update(inv.id, { stockAppliedAt: undefined, stockAppliedBy: undefined, stockMovementIds: undefined, updatedAt: nowIso() });
    return n;
  });
}

/**
 * Aprende de los renglones confirmados: cómo figura cada producto en las facturas (para
 * reconocerlo solo la próxima vez) y cuántas unidades trae la caja/bulto si el producto no lo tenía.
 */
export async function learnFromInvoice(items: InvoiceItem[] = []): Promise<number> {
  const units = await db.units.toArray();
  let changed = 0;
  for (const item of items) {
    if (item.status !== 'ok' || !item.productId) continue;
    const p = await db.products.get(item.productId);
    if (!p) continue;
    const key = aliasKey(item.description);
    const patch: Partial<Product> = {};
    if (key && !(p.invoiceAliases ?? []).includes(key) && normalize(p.name) !== normalize(item.description)) {
      patch.invoiceAliases = [key, ...(p.invoiceAliases ?? [])].slice(0, MAX_ALIASES);
    }
    if (isPackUnit(item.unit) && item.packSize && item.packSize > 1 && !(p.purchaseFactor > 1)) {
      patch.purchaseFactor = item.packSize;
      patch.purchaseUnitId = p.purchaseUnitId ?? packUnitId(units, item.unit);
    }
    if (Object.keys(patch).length) {
      await db.products.update(p.id, { ...patch, updatedAt: nowIso() });
      changed++;
    }
  }
  return changed;
}

/** Unidad de compra para un renglón en cajas o bultos (la "Caja" de base si no hay una más parecida). */
function packUnitId(units: Unit[], invoiceUnit?: string): string | undefined {
  const u = normalize(invoiceUnit ?? '');
  const bulto = /^(b|bu|bul|bult|bulto|bto)/.test(u) ? units.find((x) => /bulto/i.test(x.name)) : undefined;
  return (bulto ?? units.find((x) => normalize(x.abbreviation) === 'caja' || /^caja$/i.test(x.name)))?.id;
}

/** Nombre sugerido para un producto nuevo a partir del texto de la factura ("AMARGO OBRERO X 950 CC" → "Amargo Obrero x 950 cc"). */
export function suggestName(description: string): string {
  const clean = description.replace(/\s+/g, ' ').replace(/^[\d.,]+\s+/, '').trim();
  return clean
    .toLocaleLowerCase('es')
    .replace(/(^|\s)(\p{L})/gu, (_, sp: string, ch: string) => sp + ch.toLocaleUpperCase('es'))
    .replace(/\b(X|Cc|Ml|Kg|Gr|Lt|Lts|De|Del|Y|Con|Sin)\b/g, (w) => w.toLocaleLowerCase('es'));
}

export interface NewProductFromLine {
  name: string;
  categoryId?: string;
  unitId?: string;
  /** Unidades por caja/bulto (1 si viene suelto). */
  packSize?: number;
  supplierId?: string;
}

/** Crea un producto desde un renglón de la factura y devuelve el renglón ya vinculado y confirmado. */
export async function createProductFromLine(item: InvoiceItem, data: NewProductFromLine, lk: CatalogLookups): Promise<{ product: Product; item: InvoiceItem }> {
  const name = data.name.trim();
  if (!name) throw new Error('Poné un nombre para el producto.');
  const dupe = (await db.products.toArray()).find((p) => p.active && normalize(p.name) === normalize(name));
  if (dupe) throw new Error(`Ya existe “${dupe.name}”: elegilo de la lista en vez de crearlo.`);
  const units = await db.units.toArray();
  const given = data.packSize && data.packSize >= 1 ? Math.round(data.packSize) : undefined;
  const pack = given && given > 1 ? given : 1;
  const product = await saveProduct({
    ...emptyProduct(),
    name,
    categoryId: data.categoryId || undefined,
    unitId: data.unitId || units.find((u) => u.abbreviation === 'u')?.id,
    purchaseFactor: pack,
    purchaseUnitId: pack > 1 ? packUnitId(units, item.unit) : undefined,
    supplierId: data.supplierId || undefined,
    invoiceAliases: [aliasKey(item.description)].filter(Boolean),
  });
  return { product, item: { ...item, productId: product.id, packSize: given ?? item.packSize, stockQty: toStockQty(item.quantity, item.unit, product, lk, pack), status: 'ok' } };
}

/** Texto para mostrar el estado de carga de una factura. */
export const stockState = (inv: Pick<Invoice, 'items' | 'stockAppliedAt'>) =>
  inv.stockAppliedAt ? 'cargada' : !inv.items?.length ? 'sin-renglones' : pendingItems(inv.items).length ? 'a-revisar' : 'lista';

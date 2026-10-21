/**
 * Facturas que quedaron afuera al entrar a la nube del negocio.
 *
 * Al usar un espacio de la nube, los datos del dispositivo se reemplazan por los del espacio
 * (antes se guarda una copia local). Si en el dispositivo había facturas cargadas en otro lado
 * (por ejemplo, alguien que trabajaba sin estar invitado al espacio del negocio), se pueden traer
 * a Facturas: quedan sin cargar al stock, con los productos buscados en el catálogo actual.
 */
import { db } from '../database/db';
import { PRE_JOIN_BACKUP_KEY, uploadPendingImages } from '../cloud/cloudService';
import type { Invoice, InvoiceImage, InvoiceItem, Product, Supplier } from '../models';
import { normalize } from '../utils/format';
import { nowIso } from '../utils/id';

interface PreJoinBackup {
  tables?: { invoices?: Invoice[]; suppliers?: Supplier[]; products?: Product[] };
  pendingImages?: InvoiceImage[];
  /** Facturas ya traídas o descartadas (no se vuelven a ofrecer). */
  handled?: string[];
}

async function readBackup(): Promise<PreJoinBackup | undefined> {
  const v = (await db.meta.get(PRE_JOIN_BACKUP_KEY))?.value;
  return v && typeof v === 'object' ? (v as PreJoinBackup) : undefined;
}

const sameInvoice = (a: Invoice, b: Invoice) => !!a.number && !!b.number && normalize(a.number) === normalize(b.number) && a.date === b.date;

/** Facturas de la copia local que no están en Facturas. */
export async function recoverableInvoices(): Promise<Invoice[]> {
  const b = await readBackup();
  const list = b?.tables?.invoices ?? [];
  if (!list.length) return [];
  const current = await db.invoices.toArray();
  const ids = new Set(current.map((i) => i.id));
  const handled = new Set(b?.handled ?? []);
  return list.filter((i) => i && i.id && !ids.has(i.id) && !handled.has(i.id) && !current.some((c) => sameInvoice(c, i)));
}

async function markHandled(ids: string[]) {
  const b = await readBackup();
  if (!b) return;
  await db.meta.put({ key: PRE_JOIN_BACKUP_KEY, value: { ...b, handled: [...new Set([...(b.handled ?? []), ...ids])] } });
}

/** No volver a ofrecerlas. */
export async function dismissRecoverable(): Promise<void> {
  await markHandled((await recoverableInvoices()).map((i) => i.id));
}

/** Trae las facturas a Facturas (sin cargarlas al stock). Devuelve cuántas trajo. */
export async function recoverInvoices(): Promise<number> {
  const b = await readBackup();
  const todo = await recoverableInvoices();
  if (!b || !todo.length) return 0;
  const oldSuppliers = new Map((b.tables?.suppliers ?? []).map((x) => [x.id, x]));
  const oldProducts = new Map((b.tables?.products ?? []).map((x) => [x.id, x]));
  const images = new Map((b.pendingImages ?? []).map((x) => [x.id, x]));
  const t = nowIso();
  await db.transaction('rw', [db.invoices, db.invoiceImages, db.suppliers, db.products], async () => {
    const suppliers = await db.suppliers.toArray();
    const products = (await db.products.toArray()).filter((p) => p.active);
    const supplierFor = async (id?: string): Promise<string | undefined> => {
      if (!id) return undefined;
      if (suppliers.some((x) => x.id === id)) return id;
      const old = oldSuppliers.get(id);
      if (!old) return undefined;
      const match = suppliers.find((x) => normalize(x.name) === normalize(old.name));
      if (match) return match.id;
      const added: Supplier = { ...old, updatedAt: t };
      await db.suppliers.put(added);
      suppliers.push(added);
      return added.id;
    };
    const productFor = (id?: string): Product | undefined => {
      if (!id) return undefined;
      const same = products.find((p) => p.id === id);
      if (same) return same;
      const old = oldProducts.get(id);
      if (!old) return undefined;
      return (old.sku && products.find((p) => p.sku && normalize(p.sku) === normalize(old.sku!))) || products.find((p) => normalize(p.name) === normalize(old.name));
    };
    for (const inv of todo) {
      const items: InvoiceItem[] | undefined = inv.items?.map((it) => {
        if (it.status === 'ignored' || !it.productId) return it;
        const p = productFor(it.productId);
        if (p && p.id === it.productId) return it;
        // Otro producto (o ninguno): la cantidad en unidad de stock hay que revisarla.
        return p ? { ...it, productId: p.id, status: 'check' as const } : { ...it, productId: undefined, stockQty: undefined, status: 'none' as const };
      });
      const restored: Invoice = {
        ...inv,
        supplierId: await supplierFor(inv.supplierId),
        items,
        stockAppliedAt: undefined,
        stockAppliedBy: undefined,
        stockMovementIds: undefined,
        stockElsewhere: undefined,
        notes: [inv.notes, `Traída de un dispositivo que no estaba en la nube del negocio (${new Date(t).toLocaleDateString('es-AR')}). No está cargada al stock.`].filter(Boolean).join('\n'),
        updatedAt: t,
      };
      await db.invoices.put(restored);
      for (const page of inv.pages ?? []) {
        const img = images.get(page.id);
        if (img) await db.invoiceImages.put({ ...img, invoiceId: inv.id, uploaded: 0 });
      }
    }
  });
  await markHandled(todo.map((i) => i.id));
  void uploadPendingImages();
  return todo.length;
}

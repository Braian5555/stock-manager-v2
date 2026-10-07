/**
 * Facturas de proveedores: fotos + datos para encontrarlas (proveedor, fecha, número, total).
 * Los datos se sincronizan como cualquier tabla; las fotos se suben/bajan aparte (ver cloudService).
 */
import { db } from '../database/db';
import type { Invoice, InvoicePage } from '../models';
import { nowIso, uuid } from '../utils/id';
import { deleteCloudImages, fetchCloudImage, uploadPendingImages } from '../cloud/cloudService';
import { getCurrentActor } from './userService';
import type { CompressedImage } from './imageService';

export const MAX_PAGES = 10;

/** Página en el editor: una existente (por id) o una foto nueva recién comprimida. */
export type PageDraft = { id: string; existing: InvoicePage } | { id: string; image: CompressedImage };

export interface InvoiceDraft {
  id?: string;
  date: string;
  supplierId?: string;
  orderId?: string;
  number?: string;
  total?: number;
  notes?: string;
  pages: PageDraft[];
}

const clean = (s?: string) => (s ?? '').trim() || undefined;

export async function saveInvoice(d: InvoiceDraft): Promise<Invoice> {
  if (!d.pages.length) throw new Error('Sacá o elegí al menos una foto de la factura.');
  if (d.pages.length > MAX_PAGES) throw new Error(`Máximo ${MAX_PAGES} fotos por factura.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new Error('Ingresá la fecha de la factura.');
  if (d.total !== undefined && (!Number.isFinite(d.total) || d.total < 0)) throw new Error('El total no es válido.');

  const prev = d.id ? await db.invoices.get(d.id) : undefined;
  if (d.id && !prev) throw new Error('La factura no existe.');
  const t = nowIso();
  const id = prev?.id ?? uuid();
  const pages: InvoicePage[] = d.pages.map((p) => ('existing' in p ? p.existing : { id: p.id, width: p.image.width, height: p.image.height, bytes: p.image.bytes, thumb: p.image.thumb }));
  const kept = new Set(pages.map((p) => p.id));
  const removed = (prev?.pages ?? []).filter((p) => !kept.has(p.id)).map((p) => p.id);

  const invoice: Invoice = {
    id,
    createdAt: prev?.createdAt ?? t,
    updatedAt: t,
    date: d.date,
    supplierId: d.supplierId || undefined,
    orderId: d.orderId || undefined,
    number: clean(d.number),
    total: d.total,
    notes: clean(d.notes),
    pages,
    createdBy: prev?.createdBy ?? getCurrentActor(),
  };

  await db.transaction('rw', db.invoices, db.invoiceImages, async () => {
    await db.invoices.put(invoice);
    for (const p of d.pages) if ('image' in p) await db.invoiceImages.put({ id: p.id, invoiceId: id, type: p.image.type, data: p.image.data, uploaded: 0 });
    if (removed.length) await db.invoiceImages.bulkDelete(removed);
  });
  void uploadPendingImages();
  if (removed.length) void deleteCloudImages(removed);
  return invoice;
}

export async function deleteInvoice(id: string): Promise<void> {
  const inv = await db.invoices.get(id);
  if (!inv) return;
  await db.transaction('rw', db.invoices, db.invoiceImages, async () => {
    await db.invoices.delete(id);
    await db.invoiceImages.where('invoiceId').equals(id).delete();
  });
  void deleteCloudImages(inv.pages.map((p) => p.id));
}

/**
 * Devuelve la foto (base64). Primero busca en el dispositivo; si no está, la baja de la nube
 * y la guarda para la próxima vez.
 */
export async function getInvoiceImage(pageId: string, invoiceId: string): Promise<{ type: string; data: string }> {
  const local = await db.invoiceImages.get(pageId);
  if (local) return local;
  let remote;
  try {
    remote = await fetchCloudImage(pageId);
  } catch {
    throw new Error('La foto está en la nube. Conectate a Internet para verla.');
  }
  if (!remote) throw new Error('Esta foto no está disponible en este dispositivo.');
  await db.invoiceImages.put({ id: pageId, invoiceId, type: remote.type, data: remote.data, uploaded: 1 });
  return remote;
}

/** Nombre de archivo: factura_<proveedor>_<fecha>_<número>[_p2].jpg */
export function invoiceFileName(inv: Pick<Invoice, 'date' | 'number' | 'pages'>, supplierName: string, pageIndex: number, safe: (s: string) => string): string {
  const parts = ['factura', supplierName, inv.date, inv.number].filter(Boolean).map((p) => safe(String(p)));
  const suffix = inv.pages.length > 1 ? `_p${pageIndex + 1}` : '';
  return `${parts.join('_')}${suffix}.jpg`;
}

export const newPageId = () => uuid();

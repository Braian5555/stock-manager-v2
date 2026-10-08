/**
 * "Eliminar todos los datos": deja el negocio en cero.
 *
 * Se borra registro por registro (no con clear()) para que cada borrado deje su lápida:
 * si el dispositivo está vinculado a la nube, la eliminación llega a la nube y a los
 * demás dispositivos, y nadie vuelve a subir lo borrado.
 *
 * Se conservan: usuarios (para poder seguir entrando), la configuración del negocio
 * (nombre, logo, menú, colores) y la configuración de integraciones.
 */
import { db } from '../database/db';
import { deleteCloudImages } from '../cloud/cloudService';
import { ensureBaseCatalogs } from './seedService';

/** Tablas con datos del negocio que se vacían. */
export const WIPE_TABLES = [
  'transfers', 'outlets', 'invoices', 'countItems', 'counts', 'movements', 'orderItems', 'orders',
  'products', 'suppliers', 'locations', 'categories', 'units', 'externalReferences', 'syncJobs',
] as const;

export type WipeSummary = Record<(typeof WIPE_TABLES)[number] | 'invoiceImages', number>;

/** Cuántos registros hay hoy en cada tabla que se va a vaciar. */
export async function wipeSummary(): Promise<WipeSummary> {
  const out = {} as WipeSummary;
  for (const t of WIPE_TABLES) out[t] = await db.table(t).count();
  out.invoiceImages = await db.invoiceImages.count();
  return out;
}

export async function wipeAllData(opts: { recreateBaseCatalogs: boolean }): Promise<void> {
  const imageIds = (await db.invoiceImages.toCollection().primaryKeys()).map(String);
  for (const t of WIPE_TABLES) {
    const keys = await db.table(t).toCollection().primaryKeys();
    for (let i = 0; i < keys.length; i += 500) await db.table(t).bulkDelete(keys.slice(i, i + 500));
  }
  await db.invoiceImages.clear();
  // Las fotos de facturas van aparte de la sincronización general.
  await deleteCloudImages(imageIds);
  if (opts.recreateBaseCatalogs) await ensureBaseCatalogs();
}

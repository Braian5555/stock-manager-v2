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

/** "Empezar de cero": tablas de historia que se vacían (el catálogo y las recetas quedan). */
export const STOCK_RESET_TABLES = ['transfers', 'invoices', 'countItems', 'counts', 'movements', 'orderItems', 'orders', 'syncJobs'] as const;

export async function stockResetSummary(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of STOCK_RESET_TABLES) out[t] = await db.table(t).count();
  out.invoiceImages = await db.invoiceImages.count();
  out.withStock = await db.products.filter((p) => p.stock !== 0).count();
  out.withPlan = await db.products.filter((p) => !!p.productionPlan).count();
  return out;
}

/**
 * Empezar de cero conservando el catálogo: todo el stock en 0 y se borra la historia
 * (movimientos, conteos, pedidos, facturas, remitos y planes de producción). Productos,
 * familias, unidades, ubicaciones, proveedores, recetas, usuarios y configuración quedan.
 */
export async function resetStockKeepCatalog(): Promise<{ products: number; movements: number }> {
  const movements = await db.movements.count();
  const imageIds = (await db.invoiceImages.toCollection().primaryKeys()).map(String);
  for (const t of STOCK_RESET_TABLES) {
    const keys = await db.table(t).toCollection().primaryKeys();
    for (let i = 0; i < keys.length; i += 500) await db.table(t).bulkDelete(keys.slice(i, i + 500));
  }
  await db.invoiceImages.clear();
  await deleteCloudImages(imageIds);
  // El stock se guarda con updatedAt nuevo para que llegue en 0 a la nube y a los demás dispositivos.
  const t = new Date().toISOString();
  const touched = (await db.products.toArray()).filter((p) => p.stock !== 0 || p.productionPlan);
  for (let i = 0; i < touched.length; i += 200) {
    await db.products.bulkPut(touched.slice(i, i + 200).map((p) => ({ ...p, stock: 0, productionPlan: undefined, updatedAt: t })));
  }
  return { products: touched.length, movements };
}

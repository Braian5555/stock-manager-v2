import { db } from '../database/db';
import { MOVEMENT_LABEL, STATUS_LABEL, stockStatus } from '../services/stockService';
import { ORDER_STATUS_LABEL } from '../services/orderService';
import { getSettings } from '../services/settingsService';
import { fmtDate, fmtDateTime } from '../utils/format';

export const EXPORT_SCOPES = ['all', 'stock', 'products', 'suppliers', 'orders', 'counts', 'movements', 'settings'] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];
export const SCOPE_LABEL: Record<ExportScope, string> = {
  all: 'Todo',
  stock: 'Stock',
  products: 'Productos',
  suppliers: 'Proveedores',
  orders: 'Pedidos',
  counts: 'Conteos',
  movements: 'Movimientos',
  settings: 'Configuración',
};

export type CellValue = string | number;
export interface Dataset {
  title: string;
  columns: string[];
  rows: CellValue[][];
}

/** Construye tablas legibles (con nombres en vez de IDs) para PDF / Word / Excel. */
export async function buildDatasets(scope: ExportScope): Promise<{ title: string; datasets: Dataset[] }> {
  const [settings, products, categories, units, locations, suppliers] = await Promise.all([
    getSettings(), db.products.toArray(), db.categories.toArray(), db.units.toArray(), db.locations.toArray(), db.suppliers.toArray(),
  ]);
  const nameOf = <T extends { id: string; name: string }>(list: T[]) => {
    const m = new Map(list.map((x) => [x.id, x.name]));
    return (id?: string) => (id ? (m.get(id) ?? '') : '');
  };
  const cat = nameOf(categories), loc = nameOf(locations), sup = nameOf(suppliers), prod = nameOf(products);
  const unitAbbr = new Map(units.map((u) => [u.id, u.abbreviation]));
  const un = (id?: string) => (id ? (unitAbbr.get(id) ?? '') : '');
  const want = (s: ExportScope) => scope === 'all' || scope === s;
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const out: Dataset[] = [];

  if (want('stock'))
    out.push({
      title: 'Stock',
      columns: ['Producto', 'Código', 'Familia', 'Ubicación', 'Unidad', 'Stock', 'Mínimo', 'Máximo', 'Estado'],
      rows: sorted.filter((p) => p.active).map((p) => [p.name, p.sku ?? '', cat(p.categoryId), loc(p.locationId), un(p.unitId), p.stock, p.minStock, p.maxStock, STATUS_LABEL[stockStatus(p, settings.criticalRatio)]]),
    });
  if (want('products'))
    out.push({
      title: 'Productos',
      columns: ['Nombre', 'Código', 'Familia', 'Unidad', 'Unidad de compra', 'Factor compra', 'Ubicación', 'Proveedor', 'Proveedores alternativos', 'Mínimo', 'Máximo', 'Activo', 'Observaciones', 'Código Maxirest'],
      rows: sorted.map((p) => [p.name, p.sku ?? '', cat(p.categoryId), un(p.unitId), un(p.purchaseUnitId), p.purchaseFactor, loc(p.locationId), sup(p.supplierId), p.alternativeSupplierIds.map(sup).join(', '), p.minStock, p.maxStock, p.active ? 'Sí' : 'No', p.notes ?? '', p.externalSystems?.maxirest?.code ?? '']),
    });
  if (want('suppliers'))
    out.push({
      title: 'Proveedores',
      columns: ['Nombre', 'Contacto', 'Teléfono', 'Email', 'Dirección', 'Notas'],
      rows: [...suppliers].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((s) => [s.name, s.contact ?? '', s.phone ?? '', s.email ?? '', s.address ?? '', s.notes ?? '']),
    });
  if (want('orders')) {
    const [orders, items] = await Promise.all([db.orders.orderBy('number').reverse().toArray(), db.orderItems.toArray()]);
    out.push({
      title: 'Pedidos',
      columns: ['Número', 'Fecha', 'Proveedor', 'Estado', 'Producto', 'Cantidad', 'Recibido', 'Observaciones'],
      rows: orders.flatMap((o) => {
        const its = items.filter((i) => i.orderId === o.id);
        const head = [o.number, fmtDate(o.date), sup(o.supplierId), ORDER_STATUS_LABEL[o.status]];
        return its.length ? its.map((i) => [...head, prod(i.productId), i.quantity, i.receivedQuantity ?? '', o.notes ?? '']) : [[...head, '', '', '', o.notes ?? '']];
      }),
    });
  }
  if (want('counts')) {
    const [counts, items] = await Promise.all([db.counts.orderBy('createdAt').reverse().toArray(), db.countItems.toArray()]);
    out.push({
      title: 'Conteos',
      columns: ['Conteo', 'Fecha', 'Estado', 'Producto', 'Esperado', 'Contado', 'Diferencia'],
      rows: counts.flatMap((c) =>
        items.filter((i) => i.countId === c.id && i.counted !== undefined).map((i) => [c.name, fmtDateTime(c.createdAt), c.status, prod(i.productId), i.expected, i.counted!, i.counted! - i.expected]),
      ),
    });
  }
  if (want('movements')) {
    const movs = await db.movements.orderBy('createdAt').reverse().toArray();
    out.push({
      title: 'Movimientos',
      columns: ['Fecha y hora', 'Producto', 'Tipo', 'Anterior', 'Nuevo', 'Diferencia', 'Motivo', 'Usuario', 'Origen', 'Sistema'],
      rows: movs.map((m) => [fmtDateTime(m.createdAt), prod(m.productId) || '(eliminado)', MOVEMENT_LABEL[m.type], m.quantityBefore, m.quantityAfter, m.delta, m.reason ?? '', m.performedBy?.name ?? '', m.origin, m.sourceSystem]),
    });
  }
  if (want('settings'))
    out.push({
      title: 'Configuración',
      columns: ['Opción', 'Valor'],
      rows: [
        ['Nombre del negocio', settings.businessName], ['Subtítulo', settings.subtitle], ['Tema', settings.theme],
        ['Color principal', settings.primaryColor], ['Color secundario', settings.secondaryColor],
        ['Pedido sugerido', settings.suggestionMode === 'toMax' ? 'Completar hasta el máximo' : 'Completar hasta el mínimo'],
        ['Umbral crítico', `${Math.round(settings.criticalRatio * 100)}% del mínimo`],
        ...settings.menu.map((m) => [`Menú: ${m.key}`, `${m.label}${m.visible ? '' : ' (oculto)'}`] as CellValue[]),
      ],
    });
  return { title: `${settings.businessName} — ${SCOPE_LABEL[scope]}`, datasets: out };
}
